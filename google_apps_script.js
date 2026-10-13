/**
 * =========================================================================
 * GOOGLE APPS SCRIPT — SINKRONISASI 2-ARAH LENGKAP RESTORAN MAWAR SHARON
 * Sinkronisasi Semua Tabel: Menu, Laporan Keuangan, & Omset Bulanan 2026
 * =========================================================================
 * 
 * CARA MEMASANG / MEMPERBARUI:
 * 1. Buka Google Sheet Mawar Sharon:
 *    https://docs.google.com/spreadsheets/d/1EJP8t65ttm1CjfEfBjJYpdIrrvrvfyoUnbTMTf6IPB4/edit
 * 2. Di menu atas Google Sheet, klik: "Ekstensi" (Extensions) -> "Apps Script"
 * 3. Ganti seluruh teks di editor Apps Script dengan kode ini.
 * 4. Klik ikon disket "Simpan" (Ctrl + S).
 * 5. Klik tombol biru "Terapkan" (Deploy) di kanan atas -> Pilih "Kelola penyebaran" (Manage deployments).
 *    - Klik ikon pensil (Edit) -> Pilih Versi: "Versi baru" (New version).
 *    - ATAU pilih "Penyebaran baru" (New deployment) -> Aplikasi web -> Akses: "Siapa saja" (Anyone).
 * 6. Klik "Terapkan" (Deploy) dan salin URL Web App (akhiran /exec).
 * 7. Buka Web Dashboard -> Daftar Menu -> Klik "Sync 2-Arah" -> Tempel URL -> Simpan!
 * =========================================================================
 */

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // 20 detik kunci agar tidak race-condition

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Ekstrak data payload dari POST (JSON body) atau GET (Query parameters)
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (err) {
        payload = (e && e.parameter) || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    var action = payload.action || "PING";
    var data = payload.data || {};
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (err) {}
    }

    // -----------------------------------------------------------------------
    // AKSI 1: PING / TEST KONEKSI
    // -----------------------------------------------------------------------
    if (action === "PING" || action === "TEST") {
      return responseJSON({
        status: "success",
        message: "Koneksi Google Apps Script Webhook 2-Arah Berhasil!",
        sheetTitle: ss.getName(),
        sheets: ss.getSheets().map(function(s) { return s.getName(); }),
        timestamp: new Date().toISOString()
      });
    }

    // -----------------------------------------------------------------------
    // AKSI 2: SINKRONISASI DAFTAR HARGA MENU & STOK (HANYA ADA / HABIS)
    // -----------------------------------------------------------------------
    if (action === "UPDATE_ITEM" || action === "TOGGLE_STOCK" || action === "UPDATE_PRICE" || action === "ADD_ITEM") {
      var menuSheet = ss.getSheetByName("Daftar Harga Menu");
      if (!menuSheet) {
        return responseJSON({ status: "error", message: "Sheet 'Daftar Harga Menu' tidak ditemukan." });
      }

      // Pastikan kolom E bertuliskan 'Stok'
      var lastCol = Math.max(menuSheet.getLastColumn(), 5);
      var col5Header = menuSheet.getRange(1, 5).getValue().toString().trim();
      if (!col5Header) {
        menuSheet.getRange(1, 5).setValue("Stok");
      }

      var dataRange = menuSheet.getDataRange();
      var values = dataRange.getValues();
      var targetRow = -1;
      var searchName = (data.name || "").toString().trim().toLowerCase();

      for (var i = 1; i < values.length; i++) {
        var rowName = (values[i][1] || "").toString().trim().toLowerCase();
        if (rowName && rowName === searchName) {
          targetRow = i + 1; // 1-indexed
          break;
        }
      }

      if (targetRow > 0) {
        // Update Harga Dasar (Kolom C / 3)
        if (data.hargaDasar !== undefined && data.hargaDasar !== null && data.hargaDasar !== "") {
          var hDasar = Number(data.hargaDasar);
          menuSheet.getRange(targetRow, 3).setValue("Rp" + hDasar.toLocaleString("id-ID"));
        }

        // Update Harga + Pajak (Kolom D / 4)
        if (data.hargaPajak !== undefined && data.hargaPajak !== null && data.hargaPajak !== "") {
          var hPajak = Number(data.hargaPajak);
          menuSheet.getRange(targetRow, 4).setValue("Rp" + hPajak.toLocaleString("id-ID"));
        }

        // Update Stok (Kolom E / 5) — Hanya 2 pilihan: 'Ada' atau 'Habis'
        if (data.stok !== undefined && data.stok !== null && data.stok !== "") {
          var stokVal = (data.stok.toString().toLowerCase() === "habis") ? "Habis" : "Ada";
          menuSheet.getRange(targetRow, 5).setValue(stokVal);
        }

        return responseJSON({
          status: "success",
          action: action,
          menu: data.name,
          updatedRow: targetRow,
          timestamp: new Date().toISOString()
        });
      } else {
        // Tambah menu baru
        var dasarNum = Number(data.hargaDasar || 0);
        var pajakNum = Number(data.hargaPajak || Math.round(dasarNum * 1.1));
        var stokStr = (data.stok && data.stok.toString().toLowerCase() === "habis") ? "Habis" : "Ada";

        menuSheet.appendRow([
          "",
          data.name,
          "Rp" + dasarNum.toLocaleString("id-ID"),
          "Rp" + pajakNum.toLocaleString("id-ID"),
          stokStr
        ]);

        return responseJSON({
          status: "success",
          action: "ADD_ITEM",
          menu: data.name,
          timestamp: new Date().toISOString()
        });
      }
    }

    // -----------------------------------------------------------------------
    // AKSI 3: SINKRONISASI LAPORAN KEUANGAN & AUTO-UPDATE OMSET BULANAN
    // -----------------------------------------------------------------------
    if (action === "SYNC_LAPORAN") {
      var tgl = (data.tanggal || "").toString().trim(); // Format: YYYY-MM-DD
      var pendapatan = Number(data.pendapatan || 0);
      var bahan = Number(data.bahan || 0);
      var operasional = Number(data.operasional || 0);
      var totalBiaya = bahan + operasional;
      var labaBersih = pendapatan - totalBiaya;
      var porsiMakanan = Number(data.makananSold || 0);
      var porsiMinuman = Number(data.minumanSold || 0);
      var catatan = (data.catatan || "").toString().trim();

      if (!tgl) {
        return responseJSON({ status: "error", message: "Tanggal laporan wajib diisi." });
      }

      // 1. Simpan ke sheet 'Laporan Keuangan'
      var lapSheet = ss.getSheetByName("Laporan Keuangan");
      if (!lapSheet) {
        lapSheet = ss.insertSheet("Laporan Keuangan");
        lapSheet.appendRow(["Tanggal", "Pendapatan (Rp)", "Biaya Bahan (Rp)", "Biaya Operasional (Rp)", "Laba Bersih (Rp)", "Makanan Terjual", "Minuman Terjual", "Catatan"]);
      } else {
        // Cek header baris 1
        var lapH = lapSheet.getRange(1, 1).getValue().toString();
        if (!lapH || lapH.toLowerCase().indexOf("tanggal") === -1) {
          // Buat baris header jika belum format tabel harian
          lapSheet.insertRowBefore(1);
          lapSheet.getRange(1, 1, 1, 8).setValues([["Tanggal", "Pendapatan (Rp)", "Biaya Bahan (Rp)", "Biaya Operasional (Rp)", "Laba Bersih (Rp)", "Makanan Terjual", "Minuman Terjual", "Catatan"]]);
        }
      }

      // Cek apakah tanggal sudah pernah ada di sheet Laporan Keuangan
      var lapValues = lapSheet.getDataRange().getValues();
      var lapRowIdx = -1;
      for (var r = 1; r < lapValues.length; r++) {
        var existingDate = formatISODate(lapValues[r][0]);
        if (existingDate === tgl) {
          lapRowIdx = r + 1;
          break;
        }
      }

      var rowData = [
        tgl,
        "Rp" + pendapatan.toLocaleString("id-ID"),
        "Rp" + bahan.toLocaleString("id-ID"),
        "Rp" + operasional.toLocaleString("id-ID"),
        "Rp" + labaBersih.toLocaleString("id-ID"),
        porsiMakanan,
        porsiMinuman,
        catatan
      ];

      if (lapRowIdx > 0) {
        lapSheet.getRange(lapRowIdx, 1, 1, 8).setValues([rowData]);
      } else {
        lapSheet.appendRow(rowData);
      }

      // 2. Sinkronkan juga ke sheet 'Omset <Bulan> <Tahun>' (Contoh: Omset Oktober 2026)
      syncToMonthlyOmsetSheet(ss, tgl, pendapatan, totalBiaya, labaBersih);

      return responseJSON({
        status: "success",
        action: "SYNC_LAPORAN",
        tanggal: tgl,
        pendapatan: pendapatan,
        biaya: totalBiaya,
        labaBersih: labaBersih,
        timestamp: new Date().toISOString()
      });
    }

    // -----------------------------------------------------------------------
    // AKSI 4: SINKRONISASI LANGSUNG KE TABEL OMSET BULANAN
    // -----------------------------------------------------------------------
    if (action === "SYNC_OMSET") {
      var omsetDate = (data.tanggal || "").toString().trim();
      var omsetPend = Number(data.pendapatan || 0);
      var omsetBiaya = Number(data.biaya || 0);
      var omsetBersih = omsetPend - omsetBiaya;

      if (!omsetDate) {
        return responseJSON({ status: "error", message: "Tanggal omset wajib diisi." });
      }

      var updatedSheetName = syncToMonthlyOmsetSheet(ss, omsetDate, omsetPend, omsetBiaya, omsetBersih);

      return responseJSON({
        status: "success",
        action: "SYNC_OMSET",
        sheet: updatedSheetName,
        tanggal: omsetDate,
        timestamp: new Date().toISOString()
      });
    }

    return responseJSON({
      status: "unknown_action",
      action: action
    });

  } catch (err) {
    return responseJSON({
      status: "error",
      message: err.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper untuk menuliskan record omset ke sheet bulan terkait
 * Contoh: 2026-10-15 -> sheet 'Omset Oktober 2026'
 */
function syncToMonthlyOmsetSheet(ss, isoDateStr, pendapatan, biaya, bersih) {
  var d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return null;

  var monthsIndo = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  var monthName = monthsIndo[d.getMonth()];
  var yearNum = d.getFullYear();
  var sheetName = "Omset " + monthName + " " + yearNum;

  var omsetSheet = ss.getSheetByName(sheetName);
  var headerCol0 = "PERINCIAN OMSET BULAN " + monthName.toUpperCase() + " " + yearNum + " TGL";

  if (!omsetSheet) {
    omsetSheet = ss.insertSheet(sheetName);
    omsetSheet.appendRow([headerCol0, "PENDAPATAN", "BIAYA", "OMSET BERSIH"]);
  }

  var dayNum = d.getDate();
  var shortMonths = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
  var dayLabel = (dayNum < 10 ? "0" : "") + dayNum + "-" + shortMonths[d.getMonth()];

  var dataRange = omsetSheet.getDataRange();
  var values = dataRange.getValues();
  var targetRow = -1;

  for (var i = 1; i < values.length; i++) {
    var val0 = (values[i][0] || "").toString().trim().toLowerCase();
    if (val0 && (val0 === dayLabel.toLowerCase() || val0.indexOf(dayNum + "-") === 0 || val0.indexOf("0" + dayNum + "-") === 0)) {
      targetRow = i + 1;
      break;
    }
  }

  var rowVals = [
    dayLabel,
    "Rp" + Math.round(pendapatan).toLocaleString("id-ID"),
    "Rp" + Math.round(biaya).toLocaleString("id-ID"),
    "Rp" + Math.round(bersih).toLocaleString("id-ID")
  ];

  if (targetRow > 0) {
    omsetSheet.getRange(targetRow, 1, 1, 4).setValues([rowVals]);
  } else {
    omsetSheet.appendRow(rowVals);
  }

  return sheetName;
}

/**
 * Helper untuk normalisasi format tanggal ISO YYYY-MM-DD
 */
function formatISODate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = val.getMonth() + 1;
    var d = val.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }
  var str = val.toString().trim();
  if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
    return str.substring(0, 10);
  }
  return str;
}

function responseJSON(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
