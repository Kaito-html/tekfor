/* ============================================
   MAWAR SHARON DASHBOARD — APP.JS
   Real-time Google Sheets Integration,
   Monthly Omset Analysis & Financial Reporting
   ============================================ */

(function () {
    'use strict';

    // ---- Configuration ----
    const SPREADSHEET_ID = '1EJP8t65ttm1CjfEfBjJYpdIrrvrvfyoUnbTMTf6IPB4';
    const SHEETS = {
        profil: 'Profil Mawar Sharon',
        menu: 'Daftar Harga Menu',
        penjualan: 'Estimasi Penjualan',
        analisis: 'Analisis Menu',
        operasional: 'Ringkasan Operasional',
        omsetSeptember: 'Omset September 2026',
        omsetOktober: 'Omset Oktober 2026'
    };
    const REFRESH_INTERVAL = 12000; // 12 seconds auto-refresh for fast Google Sheets sync
    const STORAGE_KEY = 'mawarsharon_laporan';
    const STORAGE_CUSTOM_OMSET_KEY = 'mawarsharon_custom_omset';
    const STORAGE_MENU_KEY = 'mawarsharon_menu_overrides';
    const STORAGE_WEBHOOK_KEY = 'mawarsharon_webhook_url';
    const STORAGE_THEME_KEY = 'mawarsharon_theme';

    // ---- State ----
    let sheetsData = {};
    let lastSheetMenuSnapshot = {};
    let currentPage = 'dashboard';
    let selectedOmsetMonth = '2026-09';
    let currentTopMenuMonth = '2026-09';
    let currentAnalisisMonth = '2026-09';
    let omsetSearchQuery = '';
    let currentMenuFilter = 'all';
    let menuSearchQuery = '';
    let refreshTimer = null;
    let chartsInstances = {};
    const realtimeChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mawar_sharon_realtime') : null;

    // ---- DOM References ----
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ---- Utility: Fetch Google Sheets data via GViz API (No Cache) ----
    function fetchSheetCSV(sheetName) {
        const cacheBuster = Date.now();
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_t=${cacheBuster}`;
        return fetch(url, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .then(csv => parseCSV(csv));
    }

    // ---- CSV Parser ----
    function parseCSV(text) {
        const rows = [];
        let current = '';
        let inQuotes = false;
        const result = [];

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '"') {
                if (inQuotes && text[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                rows.push(current);
                current = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (current !== '' || rows.length > 0) {
                    rows.push(current);
                    result.push([...rows]);
                    rows.length = 0;
                    current = '';
                }
                if (char === '\r' && text[i + 1] === '\n') i++;
            } else {
                current += char;
            }
        }
        if (current !== '' || rows.length > 0) {
            rows.push(current);
            result.push([...rows]);
        }
        return result;
    }

    // ---- Fetch all sheets ----
    async function fetchAllData() {
        try {
            const promises = Object.entries(SHEETS).map(([key, name]) =>
                fetchSheetCSV(name).then(data => ({ key, data }))
            );
            const results = await Promise.all(promises);
            results.forEach(({ key, data }) => {
                sheetsData[key] = data;
            });
            updateLastSync();
            return true;
        } catch (err) {
            console.error('Fetch error:', err);
            showToast('Gagal memuat data dari spreadsheet.', 'error');
            return false;
        }
    }

    // ---- Update last sync time ----
    function updateLastSync() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        const lastUpEl = $('#last-update');
        if (lastUpEl) lastUpEl.textContent = `Update: ${dateStr} ${timeStr}`;
    }

    // ---- Format currency ----
    function formatRupiah(num) {
        if (isNaN(num) || num === null || num === undefined) return 'Rp0';
        return 'Rp' + Math.round(Number(num)).toLocaleString('id-ID');
    }

    // ---- Parse Rupiah string to number ----
    function parseRupiah(str) {
        if (!str) return 0;
        return parseInt(String(str).replace(/[^0-9]/g, ''), 10) || 0;
    }

    // ---- Date formatting ----
    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    // ---- Theme Management (Terang / Gelap) ----
    function getCurrentTheme() {
        return localStorage.getItem(STORAGE_THEME_KEY) || 'dark';
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        root.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_THEME_KEY, theme);

        const themeBtn = $('#theme-toggle-btn');
        if (themeBtn) {
            themeBtn.setAttribute('title', theme === 'dark' ? 'Ganti ke Mode Terang (Light)' : 'Ganti ke Mode Gelap (Dark)');
        }

        const darkPill = $('#btn-theme-dark');
        const lightPill = $('#btn-theme-light');
        if (darkPill && lightPill) {
            if (theme === 'dark') {
                darkPill.classList.add('active');
                lightPill.classList.remove('active');
            } else {
                lightPill.classList.add('active');
                darkPill.classList.remove('active');
            }
        }

        updateChartsTheme(theme);
    }

    function toggleTheme() {
        const current = getCurrentTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        showToast(`Mode tampilan diubah ke: ${next === 'dark' ? '🌙 Gelap' : '☀️ Terang'}`, 'info');
    }

    function getChartTextColor() {
        return getCurrentTheme() === 'light' ? '#475569' : '#9e9eb8';
    }

    function getChartGridColor() {
        return getCurrentTheme() === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)';
    }

    function getChartTooltipBg() {
        return getCurrentTheme() === 'light' ? 'rgba(255, 255, 255, 0.96)' : 'rgba(22, 22, 35, 0.95)';
    }

    function updateChartsTheme(theme) {
        if (typeof Chart === 'undefined') return;
        const textColor = getChartTextColor();
        Chart.defaults.color = textColor;

        if (currentPage === 'dashboard') {
            renderSalesChart();
        } else if (currentPage === 'omset') {
            const omsetData = getActiveOmsetData();
            if (omsetData) {
                renderOmsetDailyChart(omsetData);
                renderOmsetRatioChart(omsetData);
            }
        } else if (currentPage === 'laporan') {
            renderFinanceChart(getFinancialReports());
        } else if (currentPage === 'penjualan') {
            renderSalesDetailChart();
        }
    }

    // ---- Show toast notification ----
    function showToast(message, type = 'info') {
        const container = $('#toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '✓',
            error: '✕',
            info: 'ℹ'
        };

        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <span>${message}</span>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ---- LocalStorage helpers for financial reports ----
    function getLaporan() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch {
            return [];
        }
    }

    function saveLaporan(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    // ---- LocalStorage helpers for custom omset data ----
    function getCustomOmset() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_CUSTOM_OMSET_KEY)) || [];
        } catch {
            return [];
        }
    }

    function saveCustomOmset(data) {
        localStorage.setItem(STORAGE_CUSTOM_OMSET_KEY, JSON.stringify(data));
    }

    // ============================================
    // OMSET BULANAN PARSING & CALCULATIONS (LIVE MULTI-MONTH)
    // ============================================

    // Parser umum lembar omset Google Sheets
    function parseMonthSheetData(raw, monthKeyword, monthNumStr) {
        if (!raw || raw.length <= 1) return { days: [], biayaTambahan: 0, sheetTotals: null, hasValidData: false };

        const headerStr = (raw[0] || []).join(' ').toLowerCase();
        // Cek apakah isi sheet adalah omset resmi (bukan fallback dashboard gid=0)
        if (!headerStr.includes('omset') && !headerStr.includes('pendapatan') && !headerStr.includes('perincian')) {
            return { days: [], biayaTambahan: 0, sheetTotals: null, hasValidData: false };
        }

        const days = [];
        let biayaTambahan = 0;
        let sheetTotals = null;

        raw.slice(1).forEach((row) => {
            const col0 = (row[0] || '').trim();
            const col1 = (row[1] || '').trim();
            const col2 = (row[2] || '').trim();
            const col3 = (row[3] || '').trim();

            if (col0 && (monthKeyword ? col0.toLowerCase().includes(monthKeyword.toLowerCase()) : col0.includes('-'))) {
                const dayNum = parseInt(col0.split(/[-/]/)[0], 10);
                const isoDate = !isNaN(dayNum) ? `2026-${monthNumStr}-${String(dayNum).padStart(2, '0')}` : col0;
                const pendapatan = parseRupiah(col1);
                const biaya = parseRupiah(col2);
                const bersih = parseRupiah(col3);

                days.push({
                    dayNum: isNaN(dayNum) ? 1 : dayNum,
                    label: col0,
                    tanggal: isoDate,
                    pendapatan,
                    biaya,
                    bersih,
                    source: 'excel'
                });
            } else if (!col0 && col2 && !col1 && !col3) {
                biayaTambahan = parseRupiah(col2);
            } else if (!col0 && col1 && col2) {
                sheetTotals = {
                    pendapatan: parseRupiah(col1),
                    biaya: parseRupiah(col2),
                    bersih: parseRupiah(col3)
                };
            }
        });

        days.sort((a, b) => a.dayNum - b.dayNum);
        return { days, biayaTambahan, sheetTotals, hasValidData: days.length > 0 };
    }

    // Parse the Google Sheet 'Omset September 2026'
    function parseSeptemberSheetData() {
        return parseMonthSheetData(sheetsData.omsetSeptember, 'sep', '09');
    }

    // Get aggregated data for the selected month or all months (Live Multi-Bulan)
    function getOmsetData(monthKey) {
        const customEntries = getCustomOmset();
        const laporanEntries = getLaporan();

        // 1. OKTOBER 2026 (Bulan Berjalan — Live)
        if (monthKey === '2026-10') {
            const octSheet = parseMonthSheetData(sheetsData.omsetOktober, 'okt', '10');
            let mergedDays = [];

            if (octSheet.hasValidData) {
                mergedDays = [...octSheet.days];
            } else {
                // Sesuai permintaan pengguna: data Oktober belum diisi sama sekali (kosong murni)
                mergedDays = [];
            }

            // Gabungkan entri custom omset yang dicatat user untuk Oktober
            const customOct = customEntries.filter(e => (e.tanggal || '').startsWith('2026-10'));
            customOct.forEach(custom => {
                const existingIdx = mergedDays.findIndex(d => d.tanggal === custom.tanggal);
                if (existingIdx >= 0) {
                    mergedDays[existingIdx] = { ...mergedDays[existingIdx], ...custom, source: 'custom' };
                } else {
                    const dayNum = parseInt(custom.tanggal.split('-')[2], 10);
                    mergedDays.push({
                        dayNum,
                        label: `${String(dayNum).padStart(2, '0')}-Okt`,
                        tanggal: custom.tanggal,
                        pendapatan: custom.pendapatan || 0,
                        biaya: custom.biaya || 0,
                        bersih: (custom.pendapatan || 0) - (custom.biaya || 0),
                        source: 'custom'
                    });
                }
            });

            // Gabungkan entri harian dari Laporan Keuangan untuk Oktober
            const lapOct = laporanEntries.filter(l => (l.tanggal || '').startsWith('2026-10'));
            lapOct.forEach(l => {
                const existingIdx = mergedDays.findIndex(d => d.tanggal === l.tanggal);
                const dayBiaya = (l.bahan || 0) + (l.operasional || 0);
                const dayBersih = (l.pendapatan || 0) - dayBiaya;

                if (existingIdx >= 0) {
                    // Update baseline jika ada transaksi tercatat di Laporan Keuangan
                    if (mergedDays[existingIdx].source === 'live') {
                        mergedDays[existingIdx] = {
                            ...mergedDays[existingIdx],
                            pendapatan: l.pendapatan || mergedDays[existingIdx].pendapatan,
                            biaya: dayBiaya || mergedDays[existingIdx].biaya,
                            bersih: dayBersih,
                            source: 'laporan'
                        };
                    }
                } else {
                    const dayNum = parseInt(l.tanggal.split('-')[2], 10);
                    mergedDays.push({
                        dayNum,
                        label: `${String(dayNum).padStart(2, '0')}-Okt`,
                        tanggal: l.tanggal,
                        pendapatan: l.pendapatan || 0,
                        biaya: dayBiaya,
                        bersih: dayBersih,
                        source: 'laporan'
                    });
                }
            });

            mergedDays.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

            const totalPendapatan = mergedDays.reduce((acc, d) => acc + d.pendapatan, 0);
            const totalBiayaHarian = mergedDays.reduce((acc, d) => acc + d.biaya, 0);
            const biayaTambahan = octSheet.biayaTambahan || 0;
            const totalBiayaTotal = totalBiayaHarian + biayaTambahan;
            const totalBersih = octSheet.sheetTotals ? octSheet.sheetTotals.bersih : (totalPendapatan - totalBiayaTotal);

            let bestDay = null;
            let worstDay = null;
            if (mergedDays.length > 0) {
                bestDay = [...mergedDays].sort((a, b) => b.pendapatan - a.pendapatan)[0];
                worstDay = [...mergedDays].sort((a, b) => a.pendapatan - b.pendapatan)[0];
            }

            const avgPendapatan = mergedDays.length > 0 ? (totalPendapatan / mergedDays.length) : 0;
            const margin = totalPendapatan > 0 ? ((totalBersih / totalPendapatan) * 100).toFixed(1) : '0';

            return {
                monthKey: '2026-10',
                monthName: 'Oktober 2026',
                days: mergedDays,
                totalPendapatan,
                totalBiayaHarian,
                biayaTambahan,
                totalBiayaTotal,
                totalBersih,
                avgPendapatan,
                bestDay,
                worstDay,
                margin,
                isAll: false,
                isLive: true,
                isFromSheet: octSheet.hasValidData
            };
        }

        // 2. SEPTEMBER 2026 (Live Google Sheets)
        if (monthKey === '2026-09') {
            const septSheet = parseSeptemberSheetData();
            let mergedDays = [...septSheet.days];

            const customSept = customEntries.filter(e => (e.tanggal || '').startsWith('2026-09'));
            customSept.forEach(custom => {
                const existingIdx = mergedDays.findIndex(d => d.tanggal === custom.tanggal);
                if (existingIdx >= 0) {
                    mergedDays[existingIdx] = { ...mergedDays[existingIdx], ...custom, source: 'custom' };
                } else {
                    const dayNum = parseInt(custom.tanggal.split('-')[2], 10);
                    mergedDays.push({
                        dayNum,
                        label: `${String(dayNum).padStart(2, '0')}-Sep`,
                        tanggal: custom.tanggal,
                        pendapatan: custom.pendapatan || 0,
                        biaya: custom.biaya || 0,
                        bersih: (custom.pendapatan || 0) - (custom.biaya || 0),
                        source: 'custom'
                    });
                }
            });

            mergedDays.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

            const totalPendapatan = mergedDays.reduce((acc, d) => acc + d.pendapatan, 0);
            const totalBiayaHarian = mergedDays.reduce((acc, d) => acc + d.biaya, 0);
            const biayaTambahan = septSheet.biayaTambahan || 0;
            const totalBiayaTotal = totalBiayaHarian + biayaTambahan;
            const totalBersihFinal = septSheet.sheetTotals ? septSheet.sheetTotals.bersih : (totalPendapatan - totalBiayaTotal);

            let bestDay = null;
            let worstDay = null;
            if (mergedDays.length > 0) {
                bestDay = [...mergedDays].sort((a, b) => b.pendapatan - a.pendapatan)[0];
                worstDay = [...mergedDays].sort((a, b) => a.pendapatan - b.pendapatan)[0];
            }

            const avgPendapatan = mergedDays.length > 0 ? (totalPendapatan / mergedDays.length) : 0;
            const margin = totalPendapatan > 0 ? ((totalBersihFinal / totalPendapatan) * 100).toFixed(1) : '0';

            return {
                monthKey: '2026-09',
                monthName: 'September 2026',
                days: mergedDays,
                totalPendapatan,
                totalBiayaHarian,
                biayaTambahan,
                totalBiayaTotal,
                totalBersih: totalBersihFinal,
                avgPendapatan,
                bestDay,
                worstDay,
                margin,
                isAll: false,
                isLive: false,
                isFromSheet: true
            };
        }

        // 3. SEMUA BULAN (Perbandingan Tahunan)
        if (monthKey === 'all') {
            const septData = getOmsetData('2026-09');
            const octData = getOmsetData('2026-10');

            const monthsMap = {
                '2026-09': {
                    name: 'September 2026',
                    pendapatan: septData.totalPendapatan,
                    biaya: septData.totalBiayaTotal,
                    bersih: septData.totalBersih,
                    daysCount: septData.days.length,
                    margin: septData.margin
                },
                '2026-10': {
                    name: 'Oktober 2026 (Live)',
                    pendapatan: octData.totalPendapatan,
                    biaya: octData.totalBiayaTotal,
                    bersih: octData.totalBersih,
                    daysCount: octData.days.length,
                    margin: octData.margin
                }
            };

            // Masukkan bulan lainnya dari custom omset atau laporan keuangan
            [...customEntries, ...laporanEntries.map(l => ({
                tanggal: l.tanggal,
                pendapatan: l.pendapatan || 0,
                biaya: (l.bahan || 0) + (l.operasional || 0),
                bersih: (l.pendapatan || 0) - (l.bahan || 0) - (l.operasional || 0)
            }))].forEach(entry => {
                if (!entry.tanggal) return;
                const mKey = entry.tanggal.substring(0, 7);
                if (mKey === '2026-09' || mKey === '2026-10') return;

                if (!monthsMap[mKey]) {
                    const d = new Date(`${mKey}-01`);
                    const monthName = !isNaN(d.getTime()) ? d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : mKey;
                    monthsMap[mKey] = {
                        name: monthName,
                        pendapatan: 0,
                        biaya: 0,
                        bersih: 0,
                        daysCount: 0,
                        margin: '0'
                    };
                }

                monthsMap[mKey].pendapatan += entry.pendapatan || 0;
                monthsMap[mKey].biaya += entry.biaya || 0;
                monthsMap[mKey].bersih += entry.bersih || 0;
                monthsMap[mKey].daysCount += 1;
            });

            Object.values(monthsMap).forEach(m => {
                m.margin = m.pendapatan > 0 ? ((m.bersih / m.pendapatan) * 100).toFixed(1) : '0';
            });

            return {
                monthKey: 'all',
                monthName: 'Semua Bulan (Perbandingan Tahunan)',
                monthsList: Object.entries(monthsMap).map(([key, val]) => ({ key, ...val })),
                isAll: true
            };
        }

        // 4. BULAN LAINNYA (Contoh: November 2026, Desember 2026, Januari 2027, dst.)
        const targetDays = [];
        const entriesForMonth = customEntries.filter(e => (e.tanggal || '').startsWith(monthKey));

        laporanEntries.filter(l => (l.tanggal || '').startsWith(monthKey)).forEach(l => {
            if (!entriesForMonth.some(e => e.tanggal === l.tanggal)) {
                entriesForMonth.push({
                    tanggal: l.tanggal,
                    pendapatan: l.pendapatan || 0,
                    biaya: (l.bahan || 0) + (l.operasional || 0),
                    bersih: (l.pendapatan || 0) - (l.bahan || 0) - (l.operasional || 0),
                    source: 'laporan'
                });
            }
        });

        entriesForMonth.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

        entriesForMonth.forEach(e => {
            const dayParts = e.tanggal.split('-');
            const dayNum = parseInt(dayParts[2], 10);
            const d = new Date(e.tanggal);
            const shortMonth = !isNaN(d.getTime()) ? d.toLocaleDateString('id-ID', { month: 'short' }) : '';
            targetDays.push({
                dayNum: isNaN(dayNum) ? 1 : dayNum,
                label: `${String(dayNum).padStart(2, '0')}-${shortMonth}`,
                tanggal: e.tanggal,
                pendapatan: e.pendapatan || 0,
                biaya: e.biaya || 0,
                bersih: e.bersih !== undefined ? e.bersih : ((e.pendapatan || 0) - (e.biaya || 0)),
                source: e.source || 'custom'
            });
        });

        const totalPendapatan = targetDays.reduce((acc, d) => acc + d.pendapatan, 0);
        const totalBiayaHarian = targetDays.reduce((acc, d) => acc + d.biaya, 0);
        const totalBersih = targetDays.reduce((acc, d) => acc + d.bersih, 0);
        const avgPendapatan = targetDays.length > 0 ? (totalPendapatan / targetDays.length) : 0;
        const margin = totalPendapatan > 0 ? ((totalBersih / totalPendapatan) * 100).toFixed(1) : '0';

        let bestDay = null;
        let worstDay = null;
        if (targetDays.length > 0) {
            bestDay = [...targetDays].sort((a, b) => b.pendapatan - a.pendapatan)[0];
            worstDay = [...targetDays].sort((a, b) => a.pendapatan - b.pendapatan)[0];
        }

        const d = new Date(`${monthKey}-01`);
        const monthName = !isNaN(d.getTime()) ? d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : monthKey;

        return {
            monthKey,
            monthName,
            days: targetDays,
            totalPendapatan,
            totalBiayaHarian,
            biayaTambahan: 0,
            totalBiayaTotal: totalBiayaHarian,
            totalBersih,
            avgPendapatan,
            bestDay,
            worstDay,
            margin,
            isAll: false,
            isLive: true,
            isFromSheet: false
        };
    }

    // ============================================
    // RENDERING FUNCTIONS
    // ============================================

    // ---- Render Dashboard Stats ----
    function renderDashboardStats() {
        const menuData = sheetsData.menu || [];
        const penjualanData = sheetsData.penjualan || [];

        // Count menu items (including custom items and active overrides)
        const menuItems = getMenuItems();
        const menuCount = menuItems.length;

        // Get sales estimates
        let makananEst = 0, minumanEst = 0;
        if (penjualanData.length > 1) {
            penjualanData.slice(1).forEach(row => {
                const kat = (row[1] || '').toLowerCase();
                const val = parseInt(row[2]) || 0;
                if (kat.includes('makanan')) makananEst = val;
                if (kat.includes('minuman')) minumanEst = val;
            });
        }

        const totalEst = makananEst + minumanEst;

        // Active Omset Data (Bulan berjalan: Oktober 2026 atau bulan yang dipilih)
        const activeMonth = selectedOmsetMonth === 'all' ? '2026-10' : selectedOmsetMonth;
        const activeOmsetData = getOmsetData(activeMonth);
        const laporan = getLaporan();

        const statsHTML = `
            <div class="stat-card">
                <div class="stat-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
                </div>
                <div class="stat-value">${menuCount}</div>
                <div class="stat-label">Total Menu Restoran</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                </div>
                <div class="stat-value">${totalEst}</div>
                <div class="stat-label">Estimasi Porsi / Hari</div>
            </div>
            <div class="stat-card" style="cursor:pointer;" id="stat-card-omset">
                <div class="stat-icon" style="background:rgba(59,130,246,0.15);color:#3b82f6;">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </div>
                <div class="stat-value" style="color:#60a5fa;">${formatRupiah(activeOmsetData.totalPendapatan)}</div>
                <div class="stat-label">Omset ${activeOmsetData.monthName} (Live)</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
                <div class="stat-value">${laporan.length}</div>
                <div class="stat-label">Laporan Harian Tercatat</div>
            </div>
        `;
        $('#stats-grid').innerHTML = statsHTML;

        // Clickable stat card
        const cardOmset = $('#stat-card-omset');
        if (cardOmset) {
            cardOmset.addEventListener('click', () => navigateTo('omset'));
        }

        // Render Dashboard Banner stats
        const bannerRev = $('#dash-banner-rev');
        const bannerNet = $('#dash-banner-net');
        if (bannerRev) bannerRev.textContent = formatRupiah(activeOmsetData.totalPendapatan);
        if (bannerNet) bannerNet.textContent = formatRupiah(activeOmsetData.totalBersih);

        const bannerTitle = $('.omset-banner-title');
        if (bannerTitle) bannerTitle.textContent = `Perincian Omset Bulan ${activeOmsetData.monthName}`;

        const bannerTag = $('.omset-banner-tag span:last-child');
        if (bannerTag) {
            bannerTag.textContent = activeOmsetData.isFromSheet ? `DATA RESMI EXCEL ${activeOmsetData.monthName.toUpperCase()}` : `DATA LIVE RESTORAN ${activeOmsetData.monthName.toUpperCase()}`;
        }

        const bannerStats = $('#dash-banner-mini-stats');
        if (bannerStats) {
            bannerStats.innerHTML = `
                <div class="banner-mini-stat">
                    <span>Biaya Operasional</span>
                    <span>${formatRupiah(activeOmsetData.totalBiayaTotal)}</span>
                </div>
                <div class="banner-mini-stat">
                    <span>Rata-rata Harian</span>
                    <span>${formatRupiah(activeOmsetData.avgPendapatan)}</span>
                </div>
                <div class="banner-mini-stat">
                    <span>Margin Bersih</span>
                    <span style="color:var(--accent-green);">${activeOmsetData.margin}%</span>
                </div>
                <div class="banner-mini-stat">
                    <span>Hari Tertinggi</span>
                    <span style="color:var(--accent-orange);">${activeOmsetData.bestDay ? activeOmsetData.bestDay.label : '-'}</span>
                </div>
            `;
        }
    }

    // ---- Render Dashboard Profil Preview ----
    function renderProfilPreview() {
        const data = sheetsData.profil || [];
        if (data.length <= 1) {
            $('#profil-preview-body').innerHTML = '<p style="color:var(--text-muted);">Data tidak tersedia.</p>';
            return;
        }

        let html = '<div class="profil-preview-list">';
        data.slice(1).forEach(row => {
            const kat = row[1] || '';
            const detail = row[2] || '';
            const icons = {
                'Alamat': '📍',
                'Jam Operasional': '🕐',
                'Layanan': '🛎️'
            };
            html += `
                <div style="display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.85rem;">
                    <span style="font-size:1.2rem;flex-shrink:0;">${icons[kat] || '📌'}</span>
                    <div>
                        <div style="font-size:0.75rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.2rem;">${kat}</div>
                        <div style="font-size:0.88rem;line-height:1.5;">${detail}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        $('#profil-preview-body').innerHTML = html;
    }

    // ============================================
    // MENU POPULARITY PER MONTH (MAKANAN & MINUMAN TERLARIS)
    // ============================================
    function getMenuPopularityForMonth(monthKey) {
        // 1. September 2026: Data resmi Excel (Analisis Menu September)
        if (monthKey === '2026-09') {
            return {
                monthKey: '2026-09',
                monthName: 'September 2026',
                hasData: true,
                source: 'Excel (Analisis Menu September)',
                makananLaris: [
                    { rank: 1, name: 'Paket Ayam Kampung', badge: '🔥 Terlaris #1', desc: 'Favorit Utama Gorontalo' },
                    { rank: 2, name: 'Ayam Bakar Kecap', badge: '⭐ Populer', desc: 'Bumbu Khas Meresap' },
                    { rank: 3, name: 'Ikan Mujair / Nila Bakar', badge: '⭐ Populer', desc: 'Ikan Bakar Spesial Gorontalo' },
                    { rank: 4, name: 'Sate Tuna & Iloni', badge: '👍 Favorit', desc: 'Khas Rempah Gorontalo' },
                    { rank: 5, name: 'Nasi Goreng Spesial', badge: '👍 Reguler', desc: 'Pilihan Cepat & Lezat' }
                ],
                minumanLaris: [
                    { rank: 1, name: 'Jus Alpukat', badge: '🥤 Terlaris #1', desc: 'Jus Buah Segar Kental' },
                    { rank: 2, name: 'Jus Mangga (Mango Fresh)', badge: '⭐ Populer', desc: 'Manis & Menyegarkan' },
                    { rank: 3, name: 'Jus Sirsak', badge: '⭐ Populer', desc: 'Segar & Asam Manis Alami' },
                    { rank: 4, name: 'Jus Campur Buah Mawar Sharon', badge: '👍 Spesial', desc: 'Kombinasi Buah Pilihan Restoran' },
                    { rank: 5, name: 'Jus Durian', badge: '👍 Favorit', desc: 'Aroma Mantap & Legit' }
                ],
                kurangLaris: [
                    { name: 'Sayur Pangi', note: 'Permintaan harian rendah' },
                    { name: 'Sayur Garo', note: 'Porsi musiman' },
                    { name: 'Minuman Bersoda', note: 'Pelanggan lebih memilih varian jus buah segar' }
                ]
            };
        }

        // 2. Oktober 2026 (atau bulan lain):
        // Sesuai permintaan pengguna: data Oktober belum diisi sama sekali
        const laporanEntries = getLaporan().filter(l => (l.tanggal || '').startsWith(monthKey));
        const d = new Date(`${monthKey}-01`);
        const monthName = !isNaN(d.getTime()) ? d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : monthKey;

        if (laporanEntries.length === 0) {
            return {
                monthKey,
                monthName,
                hasData: false,
                source: 'Belum Ada Transaksi',
                makananLaris: [],
                minumanLaris: [],
                kurangLaris: []
            };
        }

        // Jika pengguna sudah menginput transaksi di Laporan Keuangan untuk bulan ini:
        const menuItems = getMenuItems();
        const makananAvailable = menuItems.filter(m => m.category === 'makanan' && m.stok === 'ada');
        const minumanAvailable = menuItems.filter(m => m.category === 'minuman' && m.stok === 'ada');

        return {
            monthKey,
            monthName,
            hasData: true,
            source: `Live Laporan (${laporanEntries.length} hari)`,
            makananLaris: makananAvailable.slice(0, 5).map((m, i) => ({
                rank: i + 1,
                name: m.name,
                badge: i === 0 ? '🔥 Terlaris #1' : (i < 3 ? '⭐ Populer' : '👍 Aktif'),
                desc: `${formatRupiah(m.hargaPajak)} • Stok: ${m.stok === 'ada' ? 'Tersedia' : 'Habis'}`
            })),
            minumanLaris: minumanAvailable.slice(0, 5).map((m, i) => ({
                rank: i + 1,
                name: m.name,
                badge: i === 0 ? '🥤 Terlaris #1' : (i < 3 ? '⭐ Populer' : '👍 Aktif'),
                desc: `${formatRupiah(m.hargaPajak)} • Stok: ${m.stok === 'ada' ? 'Tersedia' : 'Habis'}`
            })),
            kurangLaris: menuItems.filter(m => m.stok === 'habis').map(m => ({
                name: m.name,
                note: 'Stok saat ini kosong / habis'
            }))
        };
    }

    // ---- Render Dashboard Menu Top (Terpisah Makanan & Minuman per Bulan) ----
    function renderMenuTopPreview() {
        const popData = getMenuPopularityForMonth(currentTopMenuMonth);
        const container = $('#menu-top-body');
        if (!container) return;

        // Jaga sinkronisasi dropdown select
        const selectEl = $('#select-top-menu-month');
        if (selectEl && selectEl.value !== currentTopMenuMonth) {
            selectEl.value = currentTopMenuMonth;
        }

        if (!popData.hasData) {
            container.innerHTML = `
                <div style="text-align:center;padding:1.4rem 0.5rem;">
                    <div style="font-size:2rem;margin-bottom:0.4rem;">🍽️🥤</div>
                    <strong style="display:block;font-size:0.9rem;color:var(--text-primary);margin-bottom:0.3rem;">Data ${popData.monthName} Belum Diisi</strong>
                    <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 1rem 0;line-height:1.4;">Data menu terlaris belum tersedia karena data bulan ini belum diisi di sistem maupun spreadsheet.</p>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-top-menu-switch-sep" style="font-size:0.75rem;padding:0.35rem 0.75rem;">
                        Lihat Data September 2026
                    </button>
                </div>
            `;
            const switchBtn = $('#btn-top-menu-switch-sep');
            if (switchBtn) {
                switchBtn.addEventListener('click', () => {
                    currentTopMenuMonth = '2026-09';
                    if (selectEl) selectEl.value = '2026-09';
                    renderMenuTopPreview();
                });
            }
            return;
        }

        let html = `
            <div style="display:flex;flex-direction:column;gap:0.9rem;">
                <!-- MAKANAN TERLARIS -->
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.45rem;padding-bottom:0.25rem;border-bottom:1px solid rgba(255,255,255,0.06);">
                        <span style="font-size:0.8rem;font-weight:700;color:var(--accent-orange);display:flex;align-items:center;gap:0.35rem;">
                            🍽️ Makanan Terlaris
                        </span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">${popData.makananLaris.length} Menu</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.35rem;">
                        ${popData.makananLaris.slice(0, 3).map((item) => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0.6rem;background:rgba(255,255,255,0.02);border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.03);">
                                <div style="display:flex;align-items:center;gap:0.5rem;">
                                    <span style="width:20px;height:20px;border-radius:50%;background:rgba(249,115,22,0.15);color:var(--accent-orange);display:inline-flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;">${item.rank}</span>
                                    <span style="font-size:0.82rem;font-weight:500;">${item.name}</span>
                                </div>
                                <span style="font-size:0.68rem;color:var(--text-muted);">${item.badge || ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- MINUMAN TERLARIS -->
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.45rem;padding-bottom:0.25rem;border-bottom:1px solid rgba(255,255,255,0.06);">
                        <span style="font-size:0.8rem;font-weight:700;color:var(--accent-blue);display:flex;align-items:center;gap:0.35rem;">
                            🥤 Minuman Terlaris
                        </span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">${popData.minumanLaris.length} Menu</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.35rem;">
                        ${popData.minumanLaris.slice(0, 3).map((item) => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0.6rem;background:rgba(255,255,255,0.02);border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.03);">
                                <div style="display:flex;align-items:center;gap:0.5rem;">
                                    <span style="width:20px;height:20px;border-radius:50%;background:rgba(59,130,246,0.15);color:var(--accent-blue);display:inline-flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;">${item.rank}</span>
                                    <span style="font-size:0.82rem;font-weight:500;">${item.name}</span>
                                </div>
                                <span style="font-size:0.68rem;color:var(--text-muted);">${item.badge || ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        container.innerHTML = html;
    }

    // ---- Render Dashboard Sales Chart ----
    function renderSalesChart() {
        const data = sheetsData.penjualan || [];
        let makanan = 0, minuman = 0;
        if (data.length > 1) {
            data.slice(1).forEach(row => {
                const kat = (row[1] || '').toLowerCase();
                const val = parseInt(row[2]) || 0;
                if (kat.includes('makanan')) makanan = val;
                if (kat.includes('minuman')) minuman = val;
            });
        }

        const ctx = document.getElementById('sales-chart');
        if (!ctx) return;

        if (chartsInstances['sales']) chartsInstances['sales'].destroy();

        chartsInstances['sales'] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Makanan', 'Minuman'],
                datasets: [{
                    data: [makanan, minuman],
                    backgroundColor: [
                        'rgba(249, 115, 22, 0.8)',
                        'rgba(59, 130, 246, 0.8)'
                    ],
                    borderColor: [
                        'rgba(249, 115, 22, 1)',
                        'rgba(59, 130, 246, 1)'
                    ],
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#9e9eb8',
                            font: { family: 'Inter', size: 13, weight: 500 },
                            padding: 20,
                            usePointStyle: true,
                            pointStyleWidth: 12
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(22,22,35,0.95)',
                        titleColor: '#f1f1f4',
                        bodyColor: '#9e9eb8',
                        borderColor: 'rgba(255,255,255,0.06)',
                        borderWidth: 1,
                        cornerRadius: 10,
                        padding: 12,
                        bodyFont: { family: 'Inter' },
                        titleFont: { family: 'Outfit', weight: 700 },
                        callbacks: {
                            label: function (ctx) {
                                return ` ${ctx.label}: ${ctx.parsed} porsi`;
                            }
                        }
                    }
                },
                cutout: '65%'
            }
        });
    }

    // ============================================
    // OMSET BULANAN PAGE RENDERING
    // ============================================

    function renderOmsetPage() {
        const omsetData = getOmsetData(selectedOmsetMonth);

        // Update header & subtitles
        const chartTitle = $('#omset-chart-title');
        const tableTitle = $('#omset-table-title');
        const tableSub = $('#omset-table-subtitle');
        const countBadge = $('#table-row-count');
        const sourceBadge = $('#omset-source-badge');

        if (omsetData.isAll) {
            if (chartTitle) chartTitle.textContent = 'Perbandingan Omset Antar Bulan (Tahunan)';
            if (tableTitle) tableTitle.textContent = 'Ringkasan Omset Seluruh Bulan';
            if (tableSub) tableSub.textContent = 'Perbandingan akumulasi performa per bulan';
            if (countBadge) countBadge.textContent = `${omsetData.monthsList.length} Periode`;
            if (sourceBadge) {
                sourceBadge.className = 'badge badge-primary';
                sourceBadge.textContent = 'Akumulasi Multi-Bulan';
            }
            renderOmsetAllMonthsView(omsetData);
            return;
        }

        // Single month view
        if (chartTitle) chartTitle.textContent = `Grafik Tren Omset Harian (${omsetData.monthName}${omsetData.isLive ? ' — Live' : ''})`;
        if (tableTitle) tableTitle.textContent = `Tabel Rincian Harian — ${omsetData.monthName}`;
        if (tableSub) {
            if (selectedOmsetMonth === '2026-10') {
                tableSub.textContent = omsetData.days.length > 0
                    ? (omsetData.isFromSheet ? 'Data terverifikasi dari lembar Excel Google Sheets' : 'Data transaksi harian tercatat')
                    : 'Belum diisi di spreadsheet — catat transaksi melalui Laporan Keuangan';
            } else if (selectedOmsetMonth === '2026-09') {
                tableSub.textContent = '30 hari terverifikasi dari lembar Excel Google Sheets';
            } else {
                tableSub.textContent = `Data transaksi operasional bulan ${omsetData.monthName}`;
            }
        }
        if (countBadge) countBadge.textContent = `${omsetData.days.length} Hari`;
        if (sourceBadge) {
            if (omsetData.days.length === 0) {
                sourceBadge.className = 'badge badge-warning';
                sourceBadge.textContent = 'Belum Diisi';
            } else if (omsetData.isFromSheet) {
                sourceBadge.className = 'badge badge-success';
                sourceBadge.textContent = 'Live dari Google Sheets';
            } else if (omsetData.isLive || selectedOmsetMonth === '2026-10') {
                sourceBadge.className = 'badge badge-success';
                sourceBadge.textContent = 'Live Restoran (Bulan Berjalan)';
            } else {
                sourceBadge.className = 'badge badge-info';
                sourceBadge.textContent = 'Data Sistem Internal';
            }
        }

        // 1. Render KPI Grid
        const kpiGrid = $('#omset-kpi-grid');
        if (kpiGrid) {
            kpiGrid.innerHTML = `
                <div class="kpi-card">
                    <div class="kpi-label">Pendapatan Kotor</div>
                    <div class="kpi-value">${formatRupiah(omsetData.totalPendapatan)}</div>
                    <div class="kpi-subtext">${omsetData.days.length} Hari Penjualan</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Biaya Harian</div>
                    <div class="kpi-value">${formatRupiah(omsetData.totalBiayaHarian)}</div>
                    <div class="kpi-subtext">Bahan Baku & Operasional</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Biaya Tambahan</div>
                    <div class="kpi-value">${formatRupiah(omsetData.biayaTambahan)}</div>
                    <div class="kpi-subtext">Overhead / Extra Sheet</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Omset Bersih</div>
                    <div class="kpi-value" style="color:var(--accent-green);">${formatRupiah(omsetData.totalBersih)}</div>
                    <div class="kpi-subtext">Margin: ${omsetData.margin}%</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Rerata / Hari</div>
                    <div class="kpi-value">${formatRupiah(omsetData.avgPendapatan)}</div>
                    <div class="kpi-subtext">Rata-rata pendapatan harian</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Rekor Tertinggi</div>
                    <div class="kpi-value" style="font-size:1.1rem;color:var(--accent-orange);">${omsetData.bestDay ? formatRupiah(omsetData.bestDay.pendapatan) : '-'}</div>
                    <div class="kpi-subtext">Tgl: ${omsetData.bestDay ? omsetData.bestDay.label : '-'}</div>
                </div>
            `;
        }

        // 2. Margin Badge & Ratio Details
        const marginBadge = $('#margin-badge');
        if (marginBadge) marginBadge.textContent = `Margin Bersih: ${omsetData.margin}%`;

        const ratioDetails = $('#ratio-details');
        if (ratioDetails && omsetData.totalPendapatan > 0) {
            const pctBiaya = ((omsetData.totalBiayaHarian / omsetData.totalPendapatan) * 100).toFixed(1);
            const pctExtra = ((omsetData.biayaTambahan / omsetData.totalPendapatan) * 100).toFixed(1);
            const pctLaba = ((omsetData.totalBersih / omsetData.totalPendapatan) * 100).toFixed(1);

            ratioDetails.innerHTML = `
                <div>
                    <div class="ratio-row">
                        <span style="color:var(--text-secondary);">Biaya Harian Operasional</span>
                        <span style="font-weight:700;color:var(--accent-red);">${pctBiaya}% (${formatRupiah(omsetData.totalBiayaHarian)})</span>
                    </div>
                    <div class="ratio-bar-bg"><div class="ratio-bar-fill" style="width:${pctBiaya}%;background:var(--accent-red);"></div></div>
                </div>
                ${omsetData.biayaTambahan > 0 ? `
                <div>
                    <div class="ratio-row">
                        <span style="color:var(--text-secondary);">Biaya Tambahan / Ops Sheet</span>
                        <span style="font-weight:700;color:var(--accent-yellow);">${pctExtra}% (${formatRupiah(omsetData.biayaTambahan)})</span>
                    </div>
                    <div class="ratio-bar-bg"><div class="ratio-bar-fill" style="width:${pctExtra}%;background:var(--accent-yellow);"></div></div>
                </div>
                ` : ''}
                <div>
                    <div class="ratio-row">
                        <span style="color:var(--text-secondary);">Omset Bersih / Laba</span>
                        <span style="font-weight:700;color:var(--accent-green);">${pctLaba}% (${formatRupiah(omsetData.totalBersih)})</span>
                    </div>
                    <div class="ratio-bar-bg"><div class="ratio-bar-fill" style="width:${pctLaba}%;background:var(--accent-green);"></div></div>
                </div>
            `;
        }

        // 3. Render Daily Combo Chart
        renderOmsetDailyChart(omsetData);

        // 4. Render Ratio Doughnut Chart
        renderOmsetRatioChart(omsetData);

        // 5. Render Daily Table
        renderOmsetTable(omsetData);
    }

    // Render Daily Chart (Bar & Line combo)
    function renderOmsetDailyChart(omsetData) {
        const ctx = document.getElementById('omset-daily-chart');
        if (!ctx) return;
        if (chartsInstances['omsetDaily']) chartsInstances['omsetDaily'].destroy();

        if (omsetData.days.length === 0) {
            chartsInstances['omsetDaily'] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Belum Ada Transaksi'],
                    datasets: [{
                        label: 'Pendapatan',
                        data: [0],
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { enabled: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#5e5e7a' } },
                        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5e5e7a' }, beginAtZero: true, max: 10000000 }
                    }
                }
            });
            return;
        }

        const labels = omsetData.days.map(d => d.label || d.tanggal);
        const dataPendapatan = omsetData.days.map(d => d.pendapatan);
        const dataBiaya = omsetData.days.map(d => d.biaya);
        const dataBersih = omsetData.days.map(d => d.bersih);

        chartsInstances['omsetDaily'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'line',
                        label: 'Omset Bersih',
                        data: dataBersih,
                        borderColor: 'rgba(34, 197, 94, 1)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        borderWidth: 2.5,
                        pointBackgroundColor: 'rgba(34, 197, 94, 1)',
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        tension: 0.35,
                        order: 1
                    },
                    {
                        type: 'bar',
                        label: 'Pendapatan',
                        data: dataPendapatan,
                        backgroundColor: 'rgba(59, 130, 246, 0.75)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1.5,
                        borderRadius: 6,
                        barPercentage: 0.65,
                        order: 2
                    },
                    {
                        type: 'bar',
                        label: 'Biaya',
                        data: dataBiaya,
                        backgroundColor: 'rgba(239, 68, 68, 0.75)',
                        borderColor: 'rgba(239, 68, 68, 1)',
                        borderWidth: 1.5,
                        borderRadius: 6,
                        barPercentage: 0.65,
                        order: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(22,22,35,0.95)',
                        titleColor: '#f1f1f4',
                        bodyColor: '#9e9eb8',
                        borderColor: 'rgba(255,255,255,0.06)',
                        borderWidth: 1,
                        cornerRadius: 10,
                        padding: 12,
                        bodyFont: { family: 'Inter' },
                        titleFont: { family: 'Outfit', weight: 700 },
                        callbacks: {
                            label: function (ctx) {
                                return ` ${ctx.dataset.label}: ${formatRupiah(ctx.parsed.y)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#9e9eb8', font: { family: 'Inter', size: 10 }, maxRotation: 45 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: '#5e5e7a',
                            font: { family: 'Inter' },
                            callback: (val) => 'Rp' + (val / 1000000).toFixed(0) + 'jt'
                        },
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // Render Ratio Doughnut Chart
    function renderOmsetRatioChart(omsetData) {
        const ctx = document.getElementById('omset-ratio-chart');
        if (!ctx) return;
        if (chartsInstances['omsetRatio']) chartsInstances['omsetRatio'].destroy();

        if (omsetData.totalPendapatan === 0) {
            chartsInstances['omsetRatio'] = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Belum Ada Data'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['rgba(255, 255, 255, 0.08)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#5e5e7a', font: { family: 'Inter', size: 11 } } },
                        tooltip: { enabled: false }
                    }
                }
            });
            const ratioDetails = $('#ratio-details');
            if (ratioDetails) {
                ratioDetails.innerHTML = '<div style="text-align:center;padding:1.5rem 0;color:var(--text-muted);font-size:0.83rem;">Belum ada data keuangan untuk periode ini.</div>';
            }
            return;
        }

        const labels = ['Biaya Harian', 'Omset Bersih'];
        const dataVals = [omsetData.totalBiayaHarian, omsetData.totalBersih];
        const bgColors = ['rgba(239, 68, 68, 0.8)', 'rgba(34, 197, 94, 0.8)'];

        if (omsetData.biayaTambahan > 0) {
            labels.splice(1, 0, 'Biaya Tambahan Sheet');
            dataVals.splice(1, 0, omsetData.biayaTambahan);
            bgColors.splice(1, 0, 'rgba(234, 179, 8, 0.8)');
        }

        chartsInstances['omsetRatio'] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: dataVals,
                    backgroundColor: bgColors,
                    borderWidth: 2,
                    borderColor: 'rgba(22, 22, 35, 1)',
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#9e9eb8',
                            font: { family: 'Inter', size: 11, weight: 500 },
                            usePointStyle: true,
                            padding: 12
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(22,22,35,0.95)',
                        callbacks: {
                            label: function (ctx) {
                                return ` ${ctx.label}: ${formatRupiah(ctx.parsed)}`;
                            }
                        }
                    }
                },
                cutout: '68%'
            }
        });
    }

    // Render Daily Table
    function renderOmsetTable(omsetData) {
        const tbody = $('#omset-tbody');
        const tfoot = $('#omset-tfoot');
        if (!tbody) return;

        let filtered = omsetData.days;
        if (omsetSearchQuery) {
            const q = omsetSearchQuery.toLowerCase();
            filtered = filtered.filter(d =>
                (d.label || '').toLowerCase().includes(q) ||
                (d.tanggal || '').toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            if (omsetData.days.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="empty-state" style="padding:2.5rem 1rem;text-align:center;">
                            <div style="font-size:2.2rem;margin-bottom:0.5rem;">📅</div>
                            <strong style="display:block;margin-bottom:0.4rem;color:var(--text-primary);font-size:1.05rem;">Data Omset ${omsetData.monthName} Belum Diisi</strong>
                            <p style="color:var(--text-muted);font-size:0.85rem;max-width:440px;margin:0 auto 1.25rem auto;line-height:1.5;">
                                Bulan ini belum memiliki catatan transaksi di spreadsheet maupun sistem. Anda dapat mencatat pemasukan dan pengeluaran harian melalui menu Laporan Keuangan.
                            </p>
                            <button type="button" class="btn btn-primary btn-sm" id="btn-empty-goto-laporan" style="display:inline-flex;align-items:center;gap:0.4rem;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                <span>Buka Laporan Keuangan</span>
                            </button>
                        </td>
                    </tr>
                `;
                const btnEmpty = $('#btn-empty-goto-laporan');
                if (btnEmpty) {
                    btnEmpty.addEventListener('click', () => navigateTo('laporan'));
                }
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Tidak ada data untuk tanggal atau pencarian tersebut.</td></tr>';
            }
            if (tfoot) tfoot.innerHTML = '';
            return;
        }

        const bestPend = omsetData.bestDay ? omsetData.bestDay.pendapatan : -1;
        const worstPend = omsetData.worstDay ? omsetData.worstDay.pendapatan : -1;

        tbody.innerHTML = filtered.map((d, idx) => {
            const marginDay = d.pendapatan > 0 ? ((d.bersih / d.pendapatan) * 100).toFixed(1) : 0;
            const isBest = d.pendapatan === bestPend;
            const isWorst = d.pendapatan === worstPend;

            let badgeStatus = '<span class="badge badge-info">Normal</span>';
            if (isBest) {
                badgeStatus = '<span class="badge badge-success">🔥 Rekor Tertinggi</span>';
            } else if (isWorst) {
                badgeStatus = '<span class="badge badge-warning">📉 Terendah</span>';
            } else if (marginDay >= 50) {
                badgeStatus = '<span class="badge badge-success">Sangat Baik</span>';
            } else if (marginDay < 35) {
                badgeStatus = '<span class="badge badge-danger">Perhatian</span>';
            }

            const rowClass = isBest ? 'row-best-day' : (isWorst ? 'row-worst-day' : '');

            return `
                <tr class="${rowClass}">
                    <td style="color:var(--text-muted);font-weight:600;">${idx + 1}</td>
                    <td><strong>${d.label || d.tanggal}</strong></td>
                    <td style="color:var(--accent-blue);font-weight:600;">${formatRupiah(d.pendapatan)}</td>
                    <td style="color:var(--accent-red);">${formatRupiah(d.biaya)}</td>
                    <td style="color:var(--accent-green);font-weight:700;">${formatRupiah(d.bersih)}</td>
                    <td>${marginDay}%</td>
                    <td>${badgeStatus}</td>
                </tr>
            `;
        }).join('');

        // Grand totals row in tfoot
        if (tfoot) {
            tfoot.innerHTML = `
                <tr class="tfoot-totals">
                    <td colspan="2">TOTAL KESELURUHAN</td>
                    <td style="color:var(--accent-blue);">${formatRupiah(omsetData.totalPendapatan)}</td>
                    <td style="color:var(--accent-red);">
                        ${formatRupiah(omsetData.totalBiayaHarian)}
                        ${omsetData.biayaTambahan > 0 ? `<br><small style="font-size:0.72rem;color:var(--text-muted);">+ Extra Ops: ${formatRupiah(omsetData.biayaTambahan)}</small>` : ''}
                    </td>
                    <td style="color:var(--accent-green);">${formatRupiah(omsetData.totalBersih)}</td>
                    <td>${omsetData.margin}%</td>
                    <td><span class="badge badge-success">Terverifikasi</span></td>
                </tr>
            `;
        }
    }

    // View for All Months (Comparison Mode)
    function renderOmsetAllMonthsView(omsetData) {
        const kpiGrid = $('#omset-kpi-grid');
        const totalAllRev = omsetData.monthsList.reduce((acc, m) => acc + m.pendapatan, 0);
        const totalAllBiaya = omsetData.monthsList.reduce((acc, m) => acc + m.biaya, 0);
        const totalAllNet = omsetData.monthsList.reduce((acc, m) => acc + m.bersih, 0);
        const avgRevMonth = omsetData.monthsList.length > 0 ? (totalAllRev / omsetData.monthsList.length) : 0;
        const avgMargin = totalAllRev > 0 ? ((totalAllNet / totalAllRev) * 100).toFixed(1) : 0;

        if (kpiGrid) {
            kpiGrid.innerHTML = `
                <div class="kpi-card">
                    <div class="kpi-label">Akumulasi Pendapatan</div>
                    <div class="kpi-value">${formatRupiah(totalAllRev)}</div>
                    <div class="kpi-subtext">Dari ${omsetData.monthsList.length} Periode Bulan</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Akumulasi Biaya</div>
                    <div class="kpi-value">${formatRupiah(totalAllBiaya)}</div>
                    <div class="kpi-subtext">Seluruh Pengeluaran</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Total Omset Bersih</div>
                    <div class="kpi-value" style="color:var(--accent-green);">${formatRupiah(totalAllNet)}</div>
                    <div class="kpi-subtext">Laba Bersih Keseluruhan</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Rata-Rata / Bulan</div>
                    <div class="kpi-value">${formatRupiah(avgRevMonth)}</div>
                    <div class="kpi-subtext">Omset rata-rata per bulan</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Margin Rata-rata</div>
                    <div class="kpi-value">${avgMargin}%</div>
                    <div class="kpi-subtext">Efisiensi Profitabilitas</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Bulan Berjalan</div>
                    <div class="kpi-value" style="font-size:1.15rem;color:var(--accent-green);">Oktober '26</div>
                    <div class="kpi-subtext">Live Restoran</div>
                </div>
            `;
        }

        // Render Months comparison bar chart
        const ctx = document.getElementById('omset-daily-chart');
        if (ctx) {
            if (chartsInstances['omsetDaily']) chartsInstances['omsetDaily'].destroy();
            chartsInstances['omsetDaily'] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: omsetData.monthsList.map(m => m.name),
                    datasets: [
                        {
                            label: 'Pendapatan',
                            data: omsetData.monthsList.map(m => m.pendapatan),
                            backgroundColor: 'rgba(59, 130, 246, 0.75)',
                            borderRadius: 6
                        },
                        {
                            label: 'Biaya',
                            data: omsetData.monthsList.map(m => m.biaya),
                            backgroundColor: 'rgba(239, 68, 68, 0.75)',
                            borderRadius: 6
                        },
                        {
                            label: 'Omset Bersih',
                            data: omsetData.monthsList.map(m => m.bersih),
                            backgroundColor: 'rgba(34, 197, 94, 0.75)',
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#9e9eb8' } },
                        tooltip: {
                            callbacks: {
                                label: (c) => ` ${c.dataset.label}: ${formatRupiah(c.parsed.y)}`
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#9e9eb8' } },
                        y: {
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: { color: '#5e5e7a', callback: (v) => 'Rp' + (v / 1000000).toFixed(0) + 'jt' }
                        }
                    }
                }
            });
        }

        // Table
        const tbody = $('#omset-tbody');
        const tfoot = $('#omset-tfoot');
        if (tbody) {
            tbody.innerHTML = omsetData.monthsList.map((m, idx) => `
                <tr>
                    <td style="color:var(--text-muted);font-weight:600;">${idx + 1}</td>
                    <td><strong>${m.name}</strong></td>
                    <td style="color:var(--accent-blue);font-weight:600;">${formatRupiah(m.pendapatan)}</td>
                    <td style="color:var(--accent-red);">${formatRupiah(m.biaya)}</td>
                    <td style="color:var(--accent-green);font-weight:700;">${formatRupiah(m.bersih)}</td>
                    <td>${m.margin}%</td>
                    <td><span class="badge badge-success">${m.daysCount} Hari Tercatat</span></td>
                </tr>
            `).join('');
        }

        if (tfoot) {
            tfoot.innerHTML = `
                <tr class="tfoot-totals">
                    <td colspan="2">TOTAL TAHUNAN</td>
                    <td style="color:var(--accent-blue);">${formatRupiah(totalAllRev)}</td>
                    <td style="color:var(--accent-red);">${formatRupiah(totalAllBiaya)}</td>
                    <td style="color:var(--accent-green);">${formatRupiah(totalAllNet)}</td>
                    <td>${avgMargin}%</td>
                    <td><span class="badge badge-primary">Semua Periode</span></td>
                </tr>
            `;
        }
    }

    // ---- Render Profil Page ----
    function renderProfilPage() {
        const data = sheetsData.profil || [];
        if (data.length <= 1) {
            $('#profil-cards').innerHTML = '<p style="color:var(--text-muted);">Data tidak tersedia.</p>';
            return;
        }

        const icons = { 'Alamat': '📍', 'Jam Operasional': '🕐', 'Layanan': '🛎️' };
        let html = '';
        data.slice(1).forEach(row => {
            const kat = row[1] || '';
            const detail = row[2] || '';
            html += `
                <div class="profil-card">
                    <div class="profil-card-icon">${icons[kat] || '📌'}</div>
                    <h4>${kat}</h4>
                    <p>${detail}</p>
                </div>
            `;
        });
        $('#profil-cards').innerHTML = html;
    }

    // ============================================
    // ============================================
    // MENU & STOCK DATA MANAGEMENT (2-WAY REAL-TIME SYNC)
    // ============================================

    function getMenuOverrides() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_MENU_KEY)) || {};
        } catch {
            return {};
        }
    }

    function saveMenuOverrides(overrides) {
        localStorage.setItem(STORAGE_MENU_KEY, JSON.stringify(overrides));
        if (realtimeChannel) {
            try {
                realtimeChannel.postMessage({ type: 'MENU_UPDATE', timestamp: Date.now() });
            } catch (e) {
                console.warn('BroadcastChannel error:', e);
            }
        }
    }

    function getWebhookUrl() {
        return (localStorage.getItem(STORAGE_WEBHOOK_KEY) || '').trim();
    }

    function saveWebhookUrl(url) {
        localStorage.setItem(STORAGE_WEBHOOK_KEY, url.trim());
        updateMenuSyncBadge();
    }

    // Update UI sync badge (Menu page header & Modal)
    function updateMenuSyncBadge() {
        const url = getWebhookUrl();
        const badge = $('#menu-sync-badge');
        const statusDot = $('#webhook-status-dot');
        const statusTitle = $('#webhook-status-title');
        const statusDesc = $('#webhook-status-desc');

        if (url) {
            if (badge) {
                badge.className = 'sync-indicator-badge connected';
                badge.innerHTML = '<span class="sync-dot-mini"></span><span class="sync-badge-text">🟢 Sync 2-Arah Terhubung</span>';
                badge.title = 'Perubahan di Web langsung terkirim ke Google Sheets, dan sebaliknya';
            }
            if (statusDot) statusDot.className = 'status-indicator-dot active';
            if (statusTitle) statusTitle.textContent = 'Status: Terhubung ke Google Sheets (2-Arah Aktif)';
            if (statusDesc) statusDesc.textContent = 'Setiap perubahan harga & stok di Web akan otomatis disimpan ke Google Sheets Anda. Dan perubahan di Google Sheets akan otomatis terbaca oleh Web!';
        } else {
            if (badge) {
                badge.className = 'sync-indicator-badge not-connected';
                badge.innerHTML = '<span class="sync-dot-mini"></span><span class="sync-badge-text">🟡 Mode Lokal</span>';
                badge.title = 'Tersimpan di browser. Klik untuk menghubungkan ke Google Sheets';
            }
            if (statusDot) statusDot.className = 'status-indicator-dot';
            if (statusTitle) statusTitle.textContent = 'Status: Mode Penyimpanan Lokal (Belum Terhubung ke Sheet)';
            if (statusDesc) statusDesc.textContent = 'Perubahan harga dan stok tersimpan real-time di perangkat ini. Hubungkan Google Apps Script agar perubahan langsung otomatis tertulis di Google Sheets Anda.';
        }
    }

    // Dispatch update to Google Sheets Webhook (2-Way Sync Web -> Sheet)
    function syncToWebhook(action, itemData) {
        const url = getWebhookUrl();
        if (!url) return;

        const payload = {
            action: action,
            data: itemData,
            timestamp: new Date().toISOString()
        };

        try {
            // Gunakan Content-Type: text/plain agar Google Apps Script tidak menolak dengan CORS preflight (OPTIONS)
            fetch(url, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            }).catch(err => {
                console.warn('Webhook POST error, attempting GET fallback:', err);
                try {
                    const fallbackUrl = url + (url.includes('?') ? '&' : '?') +
                        'action=' + encodeURIComponent(action) +
                        '&data=' + encodeURIComponent(JSON.stringify(itemData)) +
                        '&_t=' + Date.now();
                    fetch(fallbackUrl, { mode: 'no-cors' }).catch(e => console.warn('Fallback GET failed:', e));
                } catch (e2) {}
            });
        } catch (e) {
            console.warn('Webhook dispatch failed:', e);
        }
    }

    // Process 2-way sync detection when fresh Google Sheets data arrives (Sheet -> Web)
    function processSheetMenuSync(raw) {
        if (!raw || raw.length <= 1) return;
        const overrides = getMenuOverrides();
        let overridesChanged = false;

        raw.slice(1).forEach((row, idx) => {
            const name = (row[1] || '').trim();
            if (!name) return;

            const id = 'sheet-menu-' + idx + '-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-');
            const sheetDasar = parseRupiah(row[2]);
            const sheetPajak = parseRupiah(row[3]);

            // Cek ketersediaan kolom Stok di Google Sheets (Kolom E / index 4)
            const rawCol4 = (row[4] || '').toString().trim().toLowerCase();
            let sheetStok = 'ada';
            if (rawCol4.includes('habis')) sheetStok = 'habis';
            else if (rawCol4.includes('ada')) sheetStok = 'ada';

            const prev = lastSheetMenuSnapshot[id];
            if (prev) {
                // Jika harga di Google Sheets diubah oleh pengguna langsung:
                if (sheetDasar && sheetDasar !== prev.hargaDasar) {
                    if (overrides[id]) {
                        overrides[id].hargaDasar = sheetDasar;
                        overrides[id].hargaPajak = sheetPajak || Math.round(sheetDasar * 1.1);
                        delete overrides[id].priceEditedByWeb; // Reset agar data Sheet menang
                        overridesChanged = true;
                    }
                }
                // Jika stok di Google Sheets diubah langsung:
                if (rawCol4 && sheetStok !== prev.stok) {
                    if (overrides[id]) {
                        overrides[id].stok = sheetStok;
                        delete overrides[id].stokEditedByWeb;
                        overridesChanged = true;
                    }
                }
            }

            lastSheetMenuSnapshot[id] = {
                name,
                hargaDasar: sheetDasar,
                hargaPajak: sheetPajak,
                stok: sheetStok
            };
        });

        if (overridesChanged) {
            localStorage.setItem(STORAGE_MENU_KEY, JSON.stringify(overrides));
            if (currentPage === 'menu') renderMenuPage(currentMenuFilter);
        }
    }

    // Get combined menu items (Google Sheets + user overrides & additions)
    function getMenuItems() {
        const raw = sheetsData.menu || [];
        processSheetMenuSync(raw);

        const overrides = getMenuOverrides();
        const minumanKeywords = ['jus', 'palabutung', 'palubutung', 'es ', 'teh', 'kopi', 'cappuccino', 'mango', 'orange', 'jeruk', 'alpukat', 'sirsak', 'buah', 'apel', 'melon', 'durian', 'campur'];

        const items = [];

        // 1. Process items from Google Sheets
        if (raw.length > 1) {
            raw.slice(1).forEach((row, idx) => {
                const name = (row[1] || '').trim();
                if (!name) return;

                const id = 'sheet-menu-' + idx + '-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-');
                const isMinuman = minumanKeywords.some(k => name.toLowerCase().includes(k));
                const category = isMinuman ? 'minuman' : 'makanan';

                // Prices from sheet
                const rawDasar = parseRupiah(row[2]);
                const rawPajak = parseRupiah(row[3]);

                // Default fallback price if empty in sheet
                let defaultDasar = rawDasar || (category === 'minuman' ? 25000 : 35000);
                let defaultPajak = rawPajak || Math.round(defaultDasar * 1.1);

                // Stock from sheet (Column 5)
                const rawCol4 = (row[4] || '').toString().trim().toLowerCase();
                let defaultStok = rawCol4.includes('habis') ? 'habis' : 'ada';

                let item = {
                    id,
                    name,
                    category,
                    hargaDasar: defaultDasar,
                    hargaPajak: defaultPajak,
                    stok: defaultStok, // Default: Ada (Hanya 2 pilihan: 'ada' vs 'habis')
                    custom: false
                };

                // Merge overrides if user edited via Web
                const ovr = overrides[id];
                if (ovr) {
                    if (ovr.priceEditedByWeb && ovr.hargaDasar) {
                        item.hargaDasar = ovr.hargaDasar;
                        item.hargaPajak = ovr.hargaPajak || Math.round(ovr.hargaDasar * 1.1);
                    }
                    if (ovr.stokEditedByWeb && ovr.stok) {
                        item.stok = ovr.stok;
                    } else if (ovr.stok && !rawCol4) {
                        item.stok = ovr.stok;
                    }
                    if (ovr.name) item.name = ovr.name;
                    if (ovr.category) item.category = ovr.category;
                }

                items.push(item);
            });
        }

        // 2. Append custom user-created menu items
        Object.entries(overrides).forEach(([key, val]) => {
            if (val && val.custom && !items.some(i => i.id === key)) {
                items.push({ id: key, ...val });
            }
        });

        return items;
    }

    // Quick Toggle Stock (Only 2 options: 'ada' vs 'habis')
    function toggleStock(itemId) {
        const overrides = getMenuOverrides();
        const items = getMenuItems();
        const target = items.find(i => i.id === itemId);
        if (!target) return;

        // Toggle strictly between 'ada' and 'habis'
        const newStock = target.stok === 'ada' ? 'habis' : 'ada';

        const existing = overrides[itemId] || {};
        overrides[itemId] = {
            ...existing,
            name: target.name,
            category: target.category,
            stok: newStock,
            stokEditedByWeb: true,
            updatedAt: new Date().toISOString()
        };
        if (existing.priceEditedByWeb) {
            overrides[itemId].hargaDasar = target.hargaDasar;
            overrides[itemId].hargaPajak = target.hargaPajak;
        }

        saveMenuOverrides(overrides);
        syncToWebhook('TOGGLE_STOCK', {
            id: itemId,
            name: target.name,
            stok: newStock,
            hargaDasar: target.hargaDasar,
            hargaPajak: target.hargaPajak
        });

        renderMenuPage(currentMenuFilter);
        updateMenuSyncBadge();

        const webhookActive = !!getWebhookUrl();
        if (webhookActive) {
            showToast(`Stok "${target.name}" diubah ke: ${newStock === 'ada' ? '🟢 Ada' : '🔴 Habis'} (Tersinkron ke Google Sheets & Web)`, 'success');
        } else {
            showToast(`Stok "${target.name}" diubah ke: ${newStock === 'ada' ? '🟢 Ada' : '🔴 Habis'} (Tersimpan di Web. Pasang Webhook di 'Sync 2-Arah' untuk Excel)`, 'info');
        }
    }

    // Update Menu Item Price & Details
    function updateMenuItem(id, newName, newCategory, newHargaDasar, newHargaPajak, newStok) {
        const overrides = getMenuOverrides();
        const items = getMenuItems();
        const target = items.find(i => i.id === id);
        if (!target) return;

        overrides[id] = {
            ...(overrides[id] || {}),
            name: newName || target.name,
            category: newCategory || target.category,
            hargaDasar: newHargaDasar,
            hargaPajak: newHargaPajak || Math.round(newHargaDasar * 1.1),
            stok: newStok || target.stok || 'ada', // 'ada' or 'habis'
            priceEditedByWeb: true,
            stokEditedByWeb: true,
            updatedAt: new Date().toISOString()
        };

        saveMenuOverrides(overrides);
        syncToWebhook('UPDATE_ITEM', {
            id,
            name: newName || target.name,
            category: newCategory || target.category,
            hargaDasar: newHargaDasar,
            hargaPajak: newHargaPajak || Math.round(newHargaDasar * 1.1),
            stok: newStok || target.stok || 'ada'
        });

        renderMenuPage(currentMenuFilter);
        updateMenuSyncBadge();

        const webhookActive = !!getWebhookUrl();
        if (webhookActive) {
            showToast(`Data menu "${newName || target.name}" berhasil diperbarui & tersinkron ke Google Sheets!`, 'success');
        } else {
            showToast(`Data menu "${newName || target.name}" diperbarui di Web. Pasang Webhook di 'Sync 2-Arah' agar langsung masuk ke Excel.`, 'info');
        }
    }

    // Force Sync Fresh Data from Google Sheets
    async function forceSyncFromSheet() {
        showToast('Mengambil data terbaru langsung dari Google Sheets...', 'info');
        // Hapus penanda override lokal untuk item spreadsheet agar data Google Sheets tampil segar
        const overrides = getMenuOverrides();
        let changed = false;
        Object.keys(overrides).forEach(k => {
            if (k.startsWith('sheet-menu-')) {
                delete overrides[k];
                changed = true;
            }
        });
        if (changed) {
            localStorage.setItem(STORAGE_MENU_KEY, JSON.stringify(overrides));
        }

        const ok = await fetchAllData();
        if (ok) {
            renderPageContent(currentPage);
            showToast('✅ Data berhasil disinkronkan langsung dari Google Sheets!', 'success');
        }
    }

    // Add New Menu Item
    function addMenuItem(name, category, hargaDasar, hargaPajak, stok) {
        const overrides = getMenuOverrides();
        const id = 'custom-' + Date.now();

        overrides[id] = {
            id,
            name,
            category,
            hargaDasar,
            hargaPajak: hargaPajak || Math.round(hargaDasar * 1.1),
            stok: stok || 'ada', // 'ada' or 'habis'
            custom: true,
            createdAt: new Date().toISOString()
        };

        saveMenuOverrides(overrides);
        syncToWebhook('ADD_ITEM', overrides[id]);
        renderMenuPage(currentMenuFilter);
        showToast(`Menu baru "${name}" berhasil ditambahkan!`, 'success');
    }

    // Reset Menu to Google Sheets Defaults
    function resetMenuToDefault() {
        if (confirm('Kembalikan semua menu dan stok ke data default dari Google Sheets? Perubahan harga dan stok yang telah Anda atur akan di-reset.')) {
            localStorage.removeItem(STORAGE_MENU_KEY);
            if (realtimeChannel) {
                try {
                    realtimeChannel.postMessage({ type: 'MENU_RESET', timestamp: Date.now() });
                } catch (e) {}
            }
            renderMenuPage(currentMenuFilter);
            showToast('Data menu & stok dikembalikan ke default Google Sheets.', 'info');
        }
    }

    // ---- Render Menu Page ----
    function renderMenuPage(filter = null) {
        if (filter !== null) {
            currentMenuFilter = filter;
        }

        // Update active filter button
        $$('.filter-btn').forEach(btn => {
            if (btn.dataset.filter === currentMenuFilter) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const allItems = getMenuItems();
        if (allItems.length === 0) {
            $('#menu-grid').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Data menu tidak tersedia.</p>';
            return;
        }

        // Update counter badges
        const countTotal = allItems.length;
        const countMakanan = allItems.filter(i => i.category === 'makanan').length;
        const countMinuman = allItems.filter(i => i.category === 'minuman').length;
        const countAda = allItems.filter(i => i.stok === 'ada').length;
        const countHabis = allItems.filter(i => i.stok === 'habis').length;
        const totalHarga = allItems.reduce((acc, i) => acc + (i.hargaDasar || 0), 0);
        const avgHarga = countTotal > 0 ? (totalHarga / countTotal) : 0;

        const statTotal = $('#menu-stat-total');
        const statAda = $('#menu-stat-ada');
        const statHabis = $('#menu-stat-habis');
        const statAvg = $('#menu-stat-avg');

        if (statTotal) statTotal.textContent = countTotal;
        if (statAda) statAda.textContent = countAda;
        if (statHabis) statHabis.textContent = countHabis;
        if (statAvg) statAvg.textContent = formatRupiah(avgHarga);

        const badgeAll = $('#count-filter-all');
        const badgeMak = $('#count-filter-makanan');
        const badgeMin = $('#count-filter-minuman');
        const badgeAda = $('#count-filter-ada');
        const badgeHabis = $('#count-filter-habis');

        if (badgeAll) badgeAll.textContent = countTotal;
        if (badgeMak) badgeMak.textContent = countMakanan;
        if (badgeMin) badgeMin.textContent = countMinuman;
        if (badgeAda) badgeAda.textContent = countAda;
        if (badgeHabis) badgeHabis.textContent = countHabis;

        // Apply filtering
        let filtered = allItems;
        if (currentMenuFilter === 'makanan') {
            filtered = filtered.filter(i => i.category === 'makanan');
        } else if (currentMenuFilter === 'minuman') {
            filtered = filtered.filter(i => i.category === 'minuman');
        } else if (currentMenuFilter === 'stok-ada') {
            filtered = filtered.filter(i => i.stok === 'ada');
        } else if (currentMenuFilter === 'stok-habis') {
            filtered = filtered.filter(i => i.stok === 'habis');
        }

        // Apply search query
        if (menuSearchQuery) {
            const q = menuSearchQuery.toLowerCase();
            filtered = filtered.filter(i => i.name.toLowerCase().includes(q));
        }

        if (filtered.length === 0) {
            $('#menu-grid').innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;padding:2rem;">Tidak ada menu yang sesuai dengan filter atau pencarian Anda.</p>';
            return;
        }

        let html = '';
        filtered.forEach(item => {
            const isMinuman = item.category === 'minuman';
            const emoji = isMinuman ? '🥤' : '🍽️';
            const isAda = item.stok === 'ada';

            const stockBadgeHTML = isAda
                ? '<span class="stock-badge ada">🟢 Stok: Ada</span>'
                : '<span class="stock-badge habis">🔴 Stok: Habis</span>';

            const stockBtnHTML = isAda
                ? `<button type="button" class="btn-quick-stock to-habis" data-id="${item.id}" title="Klik untuk ubah stok jadi Habis">🔴 Set Habis</button>`
                : `<button type="button" class="btn-quick-stock to-ada" data-id="${item.id}" title="Klik untuk ubah stok jadi Ada">🟢 Set Ada</button>`;

            html += `
                <div class="menu-card ${item.category} ${item.stok}">
                    <div>
                        <div class="menu-card-top">
                            <div class="menu-card-emoji">${emoji}</div>
                            <div class="menu-card-header-actions">
                                <span class="badge ${isMinuman ? 'badge-info' : 'badge-warning'}">${isMinuman ? 'Minuman' : 'Makanan'}</span>
                                ${stockBadgeHTML}
                            </div>
                        </div>
                        <div class="menu-card-name">${item.name}</div>
                        <div class="menu-card-prices">
                            <div class="menu-card-price">
                                <span>Harga Dasar</span>
                                <span class="price-value">${formatRupiah(item.hargaDasar)}</span>
                            </div>
                            <span class="price-arrow">→</span>
                            <div class="menu-card-price tax">
                                <span>+Pajak 10%</span>
                                <span class="price-value">${formatRupiah(item.hargaPajak)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="menu-card-actions">
                        ${stockBtnHTML}
                        <button type="button" class="btn-edit-item" data-id="${item.id}" title="Ubah harga atau stok">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                            <span>Edit</span>
                        </button>
                    </div>
                </div>
            `;
        });

        $('#menu-grid').innerHTML = html;
    }

    // ---- Render Penjualan Page ----
    function renderPenjualanPage() {
        const data = sheetsData.penjualan || [];
        let makanan = 0, minuman = 0;
        if (data.length > 1) {
            data.slice(1).forEach(row => {
                const kat = (row[1] || '').toLowerCase();
                const val = parseInt(row[2]) || 0;
                if (kat.includes('makanan')) makanan = val;
                if (kat.includes('minuman')) minuman = val;
            });
        }

        const total = makanan + minuman;

        $('#sales-overview').innerHTML = `
            <div class="sales-card">
                <div class="sales-card-icon">🍽️</div>
                <div class="sales-card-value">${makanan}</div>
                <div class="sales-card-label">Porsi Makanan / Hari</div>
            </div>
            <div class="sales-card">
                <div class="sales-card-icon">🥤</div>
                <div class="sales-card-value">${minuman}</div>
                <div class="sales-card-label">Porsi Minuman / Hari</div>
            </div>
            <div class="sales-card">
                <div class="sales-card-icon">📊</div>
                <div class="sales-card-value">${total}</div>
                <div class="sales-card-label">Total Estimasi / Hari</div>
            </div>
        `;

        const ctx = document.getElementById('sales-detail-chart');
        if (!ctx) return;
        if (chartsInstances['salesDetail']) chartsInstances['salesDetail'].destroy();

        chartsInstances['salesDetail'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Makanan', 'Minuman', 'Total'],
                datasets: [{
                    label: 'Estimasi Harian (porsi)',
                    data: [makanan, minuman, total],
                    backgroundColor: [
                        'rgba(249, 115, 22, 0.7)',
                        'rgba(59, 130, 246, 0.7)',
                        'rgba(34, 197, 94, 0.7)'
                    ],
                    borderColor: [
                        'rgba(249, 115, 22, 1)',
                        'rgba(59, 130, 246, 1)',
                        'rgba(34, 197, 94, 1)'
                    ],
                    borderWidth: 2,
                    borderRadius: 8,
                    barPercentage: 0.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#9e9eb8' } },
                    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5e5e7a' }, beginAtZero: true }
                }
            }
        });
    }

    // ---- Render Analisis Page (Berdasarkan Bulan Terpilih) ----
    function renderAnalisisPage() {
        const popData = getMenuPopularityForMonth(currentAnalisisMonth);
        const container = $('#analysis-grid');
        if (!container) return;

        // Jaga sinkronisasi dropdown select
        const selectEl = $('#select-analisis-month');
        if (selectEl && selectEl.value !== currentAnalisisMonth) {
            selectEl.value = currentAnalisisMonth;
        }

        if (!popData.hasData) {
            container.innerHTML = `
                <div class="card glass-card" style="grid-column:1 / -1;text-align:center;padding:3rem 1.5rem;">
                    <div style="font-size:3rem;margin-bottom:0.75rem;">📊</div>
                    <h3 style="font-size:1.3rem;margin-bottom:0.5rem;">Data Analisis ${popData.monthName} Belum Diisi</h3>
                    <p style="color:var(--text-muted);max-width:540px;margin:0 auto 1.5rem auto;font-size:0.9rem;line-height:1.6;">
                        Data performa makanan dan minuman untuk periode ini belum diisi di spreadsheet maupun sistem.
                        Anda dapat mencatat transaksi di menu Laporan Keuangan atau beralih ke data resmi September 2026.
                    </p>
                    <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
                        <button type="button" class="btn btn-primary" id="btn-analisis-switch-sep">
                            Lihat Analisis September 2026
                        </button>
                        <button type="button" class="btn btn-secondary" id="btn-analisis-goto-lap">
                            Input di Laporan Keuangan
                        </button>
                    </div>
                </div>
            `;
            const switchBtn = $('#btn-analisis-switch-sep');
            if (switchBtn) {
                switchBtn.addEventListener('click', () => {
                    currentAnalisisMonth = '2026-09';
                    if (selectEl) selectEl.value = '2026-09';
                    renderAnalisisPage();
                });
            }
            const gotoLapBtn = $('#btn-analisis-goto-lap');
            if (gotoLapBtn) {
                gotoLapBtn.addEventListener('click', () => navigateTo('laporan'));
            }
            return;
        }

        let html = `
            <!-- CARD 1: MAKANAN TERLARIS -->
            <div class="analysis-card popular">
                <div class="analysis-card-header">
                    <div class="icon">🍽️</div>
                    <div>
                        <h4 style="margin:0;">Makanan Terlaris</h4>
                        <span style="font-size:0.75rem;color:var(--text-muted);">${popData.monthName}</span>
                    </div>
                </div>
                <div class="analysis-card-body">
                    ${popData.makananLaris.map(item => `
                        <div class="analysis-item" style="display:flex;justify-content:space-between;align-items:center;">
                            <div style="display:flex;align-items:center;gap:0.6rem;">
                                <div class="analysis-dot" style="background:var(--accent-orange);"></div>
                                <div>
                                    <span style="font-weight:600;font-size:0.9rem;">${item.name}</span>
                                    <div style="font-size:0.75rem;color:var(--text-muted);">${item.desc || ''}</div>
                                </div>
                            </div>
                            <span class="badge badge-success" style="font-size:0.72rem;">${item.badge || '#' + item.rank}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- CARD 2: MINUMAN TERLARIS -->
            <div class="analysis-card popular" style="border-top:3px solid var(--accent-blue);">
                <div class="analysis-card-header">
                    <div class="icon">🥤</div>
                    <div>
                        <h4 style="margin:0;">Minuman Terlaris</h4>
                        <span style="font-size:0.75rem;color:var(--text-muted);">${popData.monthName}</span>
                    </div>
                </div>
                <div class="analysis-card-body">
                    ${popData.minumanLaris.map(item => `
                        <div class="analysis-item" style="display:flex;justify-content:space-between;align-items:center;">
                            <div style="display:flex;align-items:center;gap:0.6rem;">
                                <div class="analysis-dot" style="background:var(--accent-blue);"></div>
                                <div>
                                    <span style="font-weight:600;font-size:0.9rem;">${item.name}</span>
                                    <div style="font-size:0.75rem;color:var(--text-muted);">${item.desc || ''}</div>
                                </div>
                            </div>
                            <span class="badge badge-info" style="font-size:0.72rem;">${item.badge || '#' + item.rank}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- CARD 3: MENU KURANG LARIS -->
            <div class="analysis-card unpopular">
                <div class="analysis-card-header">
                    <div class="icon">📉</div>
                    <div>
                        <h4 style="margin:0;">Menu Kurang Laris</h4>
                        <span style="font-size:0.75rem;color:var(--text-muted);">Perlu Evaluasi Menu</span>
                    </div>
                </div>
                <div class="analysis-card-body">
                    ${(popData.kurangLaris.length > 0 ? popData.kurangLaris : [{ name: 'Semua menu berjalan normal', note: 'Tidak ada item dengan performa rendah' }]).map(item => `
                        <div class="analysis-item">
                            <div class="analysis-dot" style="background:var(--accent-red);"></div>
                            <div>
                                <span style="font-weight:600;font-size:0.9rem;">${item.name}</span>
                                <div style="font-size:0.75rem;color:var(--text-muted);">${item.note || ''}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    // ---- Render Operasional Page ----
    function renderOperasionalPage() {
        const data = sheetsData.operasional || [];
        if (data.length <= 1) {
            $('#ops-grid').innerHTML = '<p style="color:var(--text-muted);">Data tidak tersedia.</p>';
            return;
        }

        const icons = {
            'Metode Pembayaran': '💳',
            'Rumus Keuntungan': '📐',
            'Penanganan Waste': '♻️'
        };

        let html = '';
        data.slice(1).forEach(row => {
            const topik = row[1] || '';
            const keterangan = row[2] || '';
            html += `
                <div class="ops-card">
                    <div class="ops-card-icon">${icons[topik] || '📋'}</div>
                    <h4>${topik}</h4>
                    <p>${keterangan}</p>
                </div>
            `;
        });
        $('#ops-grid').innerHTML = html;
    }

    // ---- Render Laporan Keuangan Page ----
    function renderLaporanPage() {
        const filterMonth = $('#laporan-month-filter') ? $('#laporan-month-filter').value : 'all';
        let laporan = getLaporan().sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

        if (filterMonth !== 'all') {
            laporan = laporan.filter(l => (l.tanggal || '').startsWith(filterMonth));
        }

        // Summary
        let totalPendapatan = 0, totalBiaya = 0, totalKeuntungan = 0;
        laporan.forEach(l => {
            totalPendapatan += l.pendapatan || 0;
            totalBiaya += (l.bahan || 0) + (l.operasional || 0);
            totalKeuntungan += (l.pendapatan || 0) - (l.bahan || 0) - (l.operasional || 0);
        });

        $('#finance-summary').innerHTML = `
            <div class="finance-card">
                <div class="finance-card-label">Total Pendapatan</div>
                <div class="finance-card-value">${formatRupiah(totalPendapatan)}</div>
            </div>
            <div class="finance-card">
                <div class="finance-card-label">Total Biaya</div>
                <div class="finance-card-value">${formatRupiah(totalBiaya)}</div>
            </div>
            <div class="finance-card">
                <div class="finance-card-label">Total Keuntungan</div>
                <div class="finance-card-value">${formatRupiah(totalKeuntungan)}</div>
            </div>
        `;

        // Table
        const tbody = $('#laporan-tbody');
        if (laporan.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Belum ada laporan pada periode ini. Klik tombol Tambah Laporan atau Salin Data September.</td></tr>';
        } else {
            tbody.innerHTML = laporan.map((l, i) => {
                const keuntungan = (l.pendapatan || 0) - (l.bahan || 0) - (l.operasional || 0);
                const profitClass = keuntungan >= 0 ? 'profit-positive' : 'profit-negative';
                const safeCatatan = (l.catatan || '-').split('"').join('&quot;');
                return `
                    <tr>
                        <td>${formatDate(l.tanggal)}</td>
                        <td>${formatRupiah(l.pendapatan)}</td>
                        <td>${formatRupiah(l.bahan)}</td>
                        <td>${formatRupiah(l.operasional)}</td>
                        <td class="${profitClass}">${formatRupiah(keuntungan)}</td>
                        <td>${l.makananSold || 0}</td>
                        <td>${l.minumanSold || 0}</td>
                        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeCatatan}">${safeCatatan}</td>
                        <td>
                            <button class="btn-delete-row" data-index="${i}" title="Hapus">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        renderFinanceChart(laporan);
    }

    // Finance Chart
    function renderFinanceChart(laporan) {
        const ctx = document.getElementById('finance-chart');
        if (!ctx) return;
        if (chartsInstances['finance']) chartsInstances['finance'].destroy();

        const sorted = [...laporan].sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal)).slice(-14);

        if (sorted.length === 0) {
            chartsInstances['finance'] = new Chart(ctx, {
                type: 'line',
                data: { labels: ['Belum ada data'], datasets: [{ data: [0], borderColor: 'rgba(255,255,255,0.1)', fill: false }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#5e5e7a' } },
                        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5e5e7a' }, beginAtZero: true }
                    }
                }
            });
            return;
        }

        const labels = sorted.map(l => {
            const d = new Date(l.tanggal);
            return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        });

        chartsInstances['finance'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Pendapatan',
                        data: sorted.map(l => l.pendapatan || 0),
                        borderColor: 'rgba(59, 130, 246, 1)',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2.5
                    },
                    {
                        label: 'Biaya',
                        data: sorted.map(l => (l.bahan || 0) + (l.operasional || 0)),
                        borderColor: 'rgba(239, 68, 68, 1)',
                        backgroundColor: 'rgba(239, 68, 68, 0.05)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2.5
                    },
                    {
                        label: 'Keuntungan',
                        data: sorted.map(l => (l.pendapatan || 0) - (l.bahan || 0) - (l.operasional || 0)),
                        borderColor: 'rgba(34, 197, 94, 1)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2.5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#9e9eb8', font: { family: 'Inter' } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${formatRupiah(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#5e5e7a' } },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#5e5e7a', callback: (val) => formatRupiah(val) },
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // ============================================
    // PAGE NAVIGATION
    // ============================================

    function navigateTo(page) {
        currentPage = page;

        // Update nav active classes
        $$('.nav-item').forEach(el => el.classList.remove('active'));
        const activeNav = $(`[data-page="${page}"]`);
        if (activeNav) activeNav.classList.add('active');

        // Update active page container
        $$('.page').forEach(el => el.classList.remove('active'));
        const activePage = $(`#page-${page}`);
        if (activePage) {
            activePage.classList.remove('active');
            void activePage.offsetWidth; // force reflow for smooth animation
            activePage.classList.add('active');
        }

        // Update title
        const titles = {
            dashboard: 'Dashboard Restoran',
            omset: 'Omset Bulanan',
            laporan: 'Laporan Keuangan',
            menu: 'Daftar Menu',
            penjualan: 'Estimasi Penjualan',
            analisis: 'Analisis Menu',
            profil: 'Profil Restoran',
            operasional: 'Ringkasan Operasional'
        };
        $('#page-title').textContent = titles[page] || 'Dashboard';

        // Close mobile sidebar
        closeSidebar();

        // Render page content
        renderPageContent(page);
    }

    function renderPageContent(page) {
        switch (page) {
            case 'dashboard':
                renderDashboardStats();
                renderProfilPreview();
                renderMenuTopPreview();
                renderSalesChart();
                break;
            case 'omset':
                renderOmsetPage();
                break;
            case 'laporan':
                renderLaporanPage();
                break;
            case 'menu':
                renderMenuPage();
                break;
            case 'penjualan':
                renderPenjualanPage();
                break;
            case 'analisis':
                renderAnalisisPage();
                break;
            case 'profil':
                renderProfilPage();
                break;
            case 'operasional':
                renderOperasionalPage();
                break;
        }
    }

    // ============================================
    // SIDEBAR TOGGLE
    // ============================================

    function openSidebar() {
        $('#sidebar').classList.add('open');
        $('#sidebar-overlay').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        $('#sidebar').classList.remove('open');
        $('#sidebar-overlay').classList.remove('active');
        document.body.style.overflow = '';
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    function setupEventListeners() {
        // Navigation clicks
        $$('.nav-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const page = el.dataset.page;
                if (page) navigateTo(page);
            });
        });

        // Quick button topbar to Omset
        const quickOmsetBtn = $('#quick-omset-btn');
        if (quickOmsetBtn) {
            quickOmsetBtn.addEventListener('click', () => navigateTo('omset'));
        }

        // Dashboard banner button
        const btnGotoOmset = $('#btn-goto-omset');
        if (btnGotoOmset) {
            btnGotoOmset.addEventListener('click', () => navigateTo('omset'));
        }

        // Sidebar toggle
        $('#menu-toggle').addEventListener('click', openSidebar);
        $('#sidebar-close').addEventListener('click', closeSidebar);
        $('#sidebar-overlay').addEventListener('click', closeSidebar);

        // Refresh button
        $('#refresh-btn').addEventListener('click', async () => {
            $('#refresh-btn').style.transform = 'rotate(360deg)';
            $('#refresh-btn').style.transition = 'transform 0.6s';
            setTimeout(() => {
                $('#refresh-btn').style.transform = '';
                $('#refresh-btn').style.transition = '';
            }, 600);

            showToast('Menyinkronkan data dari Google Sheets...', 'info');
            const ok = await fetchAllData();
            if (ok) {
                renderPageContent(currentPage);
                showToast('Data Google Sheets & Omset Restoran berhasil diperbarui!', 'success');
            }
        });

        // Omset month selector change
        const omsetMonthSelect = $('#omset-select-month');
        if (omsetMonthSelect) {
            omsetMonthSelect.addEventListener('change', (e) => {
                selectedOmsetMonth = e.target.value;
                renderOmsetPage();
            });
        }

        // Omset table search
        const omsetSearch = $('#omset-search-table');
        if (omsetSearch) {
            omsetSearch.addEventListener('input', (e) => {
                omsetSearchQuery = e.target.value;
                const omsetData = getOmsetData(selectedOmsetMonth);
                renderOmsetTable(omsetData);
            });
        }

        // Navigasi cepat dari Omset ke Laporan Keuangan (pencatatan pemasukan/pengeluaran terpusat)
        const btnGotoLapKeuangan = $('#btn-goto-laporan-keuangan');
        if (btnGotoLapKeuangan) {
            btnGotoLapKeuangan.addEventListener('click', () => {
                navigateTo('laporan');
                showToast('Catat pemasukan dan pengeluaran harian di Laporan Keuangan.', 'info');
            });
        }

        // Pilihan bulan untuk Makanan & Minuman Terlaris di Dashboard
        const selectTopMenu = $('#select-top-menu-month');
        if (selectTopMenu) {
            selectTopMenu.addEventListener('change', (e) => {
                currentTopMenuMonth = e.target.value;
                renderMenuTopPreview();
            });
        }

        // Pilihan bulan untuk Analisis Menu
        const selectAnalisis = $('#select-analisis-month');
        if (selectAnalisis) {
            selectAnalisis.addEventListener('change', (e) => {
                currentAnalisisMonth = e.target.value;
                renderAnalisisPage();
            });
        }

        // Export Omset CSV
        const btnExportOmset = $('#btn-export-omset-csv');
        if (btnExportOmset) {
            btnExportOmset.addEventListener('click', () => {
                const omsetData = getOmsetData(selectedOmsetMonth);
                if (omsetData.isAll) {
                    // Export all months summary
                    const headers = ['Bulan', 'Total Pendapatan', 'Total Biaya', 'Omset Bersih', 'Margin (%)', 'Jumlah Hari'];
                    const rows = omsetData.monthsList.map(m => [
                        `"${m.name}"`,
                        m.pendapatan,
                        m.biaya,
                        m.bersih,
                        `"${m.margin}%"`,
                        m.daysCount
                    ].join(','));
                    downloadCSV(`omset_semua_bulan_${new Date().toISOString().split('T')[0]}.csv`, [headers.join(','), ...rows].join('\n'));
                } else {
                    // Export daily breakdown for that month
                    const headers = ['Tanggal', 'Label', 'Pendapatan (Rp)', 'Biaya (Rp)', 'Omset Bersih (Rp)', 'Margin (%)'];
                    const rows = omsetData.days.map(d => {
                        const m = d.pendapatan > 0 ? ((d.bersih / d.pendapatan) * 100).toFixed(1) : 0;
                        return [
                            d.tanggal,
                            `"${d.label || d.tanggal}"`,
                            d.pendapatan,
                            d.biaya,
                            d.bersih,
                            `"${m}%"`
                        ].join(',');
                    });
                    downloadCSV(`omset_${selectedOmsetMonth}_mawar_sharon.csv`, [headers.join(','), ...rows].join('\n'));
                }
                showToast('File CSV Omset berhasil diunduh!', 'success');
            });
        }

        // Sync Omset Bulan Terpilih to Laporan Keuangan
        const btnSyncSept = $('#btn-sync-from-september');
        if (btnSyncSept) {
            btnSyncSept.addEventListener('click', () => {
                const activeMonth = selectedOmsetMonth === 'all' ? '2026-10' : selectedOmsetMonth;
                const omsetData = getOmsetData(activeMonth);
                const days = omsetData.days || [];
                if (days.length === 0) {
                    showToast(`Belum ada data omset untuk periode ${omsetData.monthName}.`, 'error');
                    return;
                }

                if (confirm(`Salin ${days.length} hari omset bulan ${omsetData.monthName} ke Laporan Keuangan? Data yang sudah ada tidak akan hilang.`)) {
                    const currentLaporan = getLaporan();
                    let addedCount = 0;

                    days.forEach(d => {
                        if (!currentLaporan.some(l => l.tanggal === d.tanggal)) {
                            // Split biaya 60% bahan baku, 40% operasional sebagai pendekatan standar
                            const bahan = Math.round(d.biaya * 0.6);
                            const ops = d.biaya - bahan;
                            currentLaporan.push({
                                tanggal: d.tanggal,
                                pendapatan: d.pendapatan,
                                bahan: bahan,
                                operasional: ops,
                                makananSold: 400,
                                minumanSold: 200,
                                catatan: `Impor resmi dari Omset ${omsetData.monthName}`,
                                createdAt: new Date().toISOString()
                            });
                            addedCount++;
                        }
                    });

                    saveLaporan(currentLaporan);
                    renderLaporanPage();
                    if (currentPage === 'dashboard') renderDashboardStats();
                    showToast(`${addedCount} data harian ${omsetData.monthName} berhasil disalin ke Laporan Keuangan!`, 'success');
                }
            });
        }

        // Filter month on Laporan Keuangan
        const lapMonthFilter = $('#laporan-month-filter');
        if (lapMonthFilter) {
            lapMonthFilter.addEventListener('change', () => {
                renderLaporanPage();
            });
        }

        // Menu filter pills
        const menuFilterEl = $('#menu-filter');
        if (menuFilterEl) {
            menuFilterEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.filter-btn');
                if (!btn) return;
                currentMenuFilter = btn.dataset.filter || 'all';
                renderMenuPage(currentMenuFilter);
            });
        }

        // Menu search input (real-time search)
        const menuSearchInput = $('#menu-search-input');
        if (menuSearchInput) {
            menuSearchInput.addEventListener('input', (e) => {
                menuSearchQuery = e.target.value.trim();
                renderMenuPage(currentMenuFilter);
            });
        }

        // Delegated clicks on Menu Grid: Quick Stock Toggle & Edit Item
        const menuGrid = $('#menu-grid');
        if (menuGrid) {
            menuGrid.addEventListener('click', (e) => {
                // Quick Stock toggle click
                const stockBtn = e.target.closest('.btn-quick-stock');
                if (stockBtn) {
                    e.preventDefault();
                    toggleStock(stockBtn.dataset.id);
                    return;
                }

                // Edit Item click
                const editBtn = e.target.closest('.btn-edit-item');
                if (editBtn) {
                    e.preventDefault();
                    const itemId = editBtn.dataset.id;
                    const items = getMenuItems();
                    const item = items.find(i => i.id === itemId);
                    if (!item) return;

                    $('#edit-menu-id').value = item.id;
                    $('#edit-menu-name').value = item.name;
                    $('#edit-menu-category').value = item.category;
                    $('#edit-menu-harga-dasar').value = item.hargaDasar;
                    $('#edit-menu-harga-pajak').value = item.hargaPajak;

                    // ONLY 2 CHOICES: 'ada' vs 'habis'
                    if (item.stok === 'habis') {
                        $('#radio-stok-habis').checked = true;
                    } else {
                        $('#radio-stok-ada').checked = true;
                    }

                    $('#modal-edit-menu').classList.remove('hidden');
                    return;
                }
            });
        }

        // Auto calculate 10% tax in Edit Menu modal
        const editHargaDasar = $('#edit-menu-harga-dasar');
        if (editHargaDasar) {
            editHargaDasar.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10) || 0;
                $('#edit-menu-harga-pajak').value = Math.round(val * 1.1);
            });
        }

        // Submit Edit Menu form
        const formEditMenu = $('#form-edit-menu');
        if (formEditMenu) {
            formEditMenu.addEventListener('submit', (e) => {
                e.preventDefault();
                const id = $('#edit-menu-id').value;
                const name = $('#edit-menu-name').value.trim();
                const category = $('#edit-menu-category').value;
                const hargaDasar = parseInt($('#edit-menu-harga-dasar').value, 10) || 0;
                const hargaPajak = parseInt($('#edit-menu-harga-pajak').value, 10) || Math.round(hargaDasar * 1.1);
                
                // Get checked stock radio (only 2 options: 'ada' or 'habis')
                const checkedRadio = formEditMenu.querySelector('input[name="edit-menu-stok"]:checked');
                const stok = checkedRadio ? checkedRadio.value : 'ada';

                updateMenuItem(id, name, category, hargaDasar, hargaPajak, stok);
                $('#modal-edit-menu').classList.add('hidden');
            });
        }

        // Add Menu Modal controls
        const btnOpenAddMenu = $('#btn-open-add-menu');
        const modalAddMenu = $('#modal-add-menu');
        const formAddMenu = $('#form-add-menu');

        if (btnOpenAddMenu && modalAddMenu) {
            btnOpenAddMenu.addEventListener('click', () => {
                if (formAddMenu) formAddMenu.reset();
                modalAddMenu.classList.remove('hidden');
                $('#add-menu-name').focus();
            });
        }

        // Auto calculate 10% tax in Add Menu modal
        const addHargaDasar = $('#add-menu-harga-dasar');
        if (addHargaDasar) {
            addHargaDasar.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10) || 0;
                $('#add-menu-harga-pajak').value = Math.round(val * 1.1);
            });
        }

        // Submit Add Menu form
        if (formAddMenu) {
            formAddMenu.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = $('#add-menu-name').value.trim();
                const category = $('#add-menu-category').value;
                const hargaDasar = parseInt($('#add-menu-harga-dasar').value, 10) || 0;
                const hargaPajak = parseInt($('#add-menu-harga-pajak').value, 10) || Math.round(hargaDasar * 1.1);
                const checkedRadio = formAddMenu.querySelector('input[name="add-menu-stok"]:checked');
                const stok = checkedRadio ? checkedRadio.value : 'ada';

                addMenuItem(name, category, hargaDasar, hargaPajak, stok);
                modalAddMenu.classList.add('hidden');
            });
        }

        // Reset Menu to Google Sheets Defaults
        const btnResetMenu = $('#btn-reset-menu');
        if (btnResetMenu) {
            btnResetMenu.addEventListener('click', resetMenuToDefault);
        }

        // Export Menu CSV
        const btnExportMenuCSV = $('#btn-export-menu-csv');
        if (btnExportMenuCSV) {
            btnExportMenuCSV.addEventListener('click', () => {
                const items = getMenuItems();
                const headers = ['No', 'Nama Menu', 'Kategori', 'Harga Dasar (Rp)', 'Harga + Pajak 10% (Rp)', 'Status Stok'];
                const rows = items.map((i, idx) => [
                    idx + 1,
                    `"${i.name.split('"').join('""')}"`,
                    i.category === 'minuman' ? 'Minuman' : 'Makanan',
                    i.hargaDasar,
                    i.hargaPajak,
                    i.stok === 'ada' ? 'Ada' : 'Habis'
                ].join(','));
                downloadCSV(`daftar_menu_stok_mawar_sharon_${new Date().toISOString().split('T')[0]}.csv`, [headers.join(','), ...rows].join('\n'));
                showToast('Daftar menu & stok berhasil diekspor!', 'success');
            });
        }

        // Webhook Modal Controls & 2-Way Sync
        const btnOpenWebhook = $('#btn-open-sheets-webhook');
        const modalWebhook = $('#modal-webhook-sync');
        const inputWebhook = $('#input-webhook-url');
        const btnSaveWebhook = $('#btn-save-webhook');
        const btnClearWebhook = $('#btn-clear-webhook');
        const btnTestWebhook = $('#btn-test-webhook');
        const btnCopyAppsScript = $('#btn-copy-apps-script');
        const menuSyncBadge = $('#menu-sync-badge');
        const btnForceSync = $('#btn-force-sheet-sync');

        // Badge click to open webhook settings
        if (menuSyncBadge && modalWebhook) {
            menuSyncBadge.addEventListener('click', () => {
                if (inputWebhook) inputWebhook.value = getWebhookUrl();
                updateMenuSyncBadge();
                modalWebhook.classList.remove('hidden');
            });
        }

        // Force sync directly from Google Sheets
        if (btnForceSync) {
            btnForceSync.addEventListener('click', forceSyncFromSheet);
        }

        // Open Webhook modal
        if (btnOpenWebhook && modalWebhook) {
            btnOpenWebhook.addEventListener('click', () => {
                if (inputWebhook) inputWebhook.value = getWebhookUrl();
                updateMenuSyncBadge();
                modalWebhook.classList.remove('hidden');
            });
        }

        // Save Webhook URL
        if (btnSaveWebhook && inputWebhook) {
            btnSaveWebhook.addEventListener('click', () => {
                const url = inputWebhook.value.trim();
                saveWebhookUrl(url);
                showToast(url ? '✅ URL Webhook berhasil disimpan! Sinkronisasi 2-arah aktif.' : 'URL Webhook dikosongkan. Kembali ke mode lokal.', 'success');
                modalWebhook.classList.add('hidden');
            });
        }

        // Clear Webhook URL
        if (btnClearWebhook) {
            btnClearWebhook.addEventListener('click', () => {
                if (confirm('Hapus URL Webhook Google Apps Script? Sinkronisasi langsung ke Google Sheets akan dimatikan.')) {
                    saveWebhookUrl('');
                    if (inputWebhook) inputWebhook.value = '';
                    showToast('URL Webhook dihapus. Kembali ke mode penyimpanan lokal.', 'info');
                }
            });
        }

        // Test Webhook Connection
        if (btnTestWebhook && inputWebhook) {
            btnTestWebhook.addEventListener('click', async () => {
                const url = inputWebhook.value.trim();
                if (!url) {
                    showToast('Silakan tempelkan URL Webhook Google Apps Script terlebih dahulu.', 'warning');
                    return;
                }
                showToast('Menguji koneksi ke Google Sheets...', 'info');
                try {
                    const pingUrl = url + (url.includes('?') ? '&' : '?') + 'action=PING&_t=' + Date.now();
                    await fetch(pingUrl, { mode: 'no-cors' });
                    showToast('✅ Sinyal koneksi terkirim! Pastikan status deployment Web App Anda "Siapa Saja (Anyone)".', 'success');
                } catch (err) {
                    showToast('Gagal menghubungi Webhook: ' + err.message, 'error');
                }
            });
        }

        // Copy Google Apps Script code to clipboard
        if (btnCopyAppsScript) {
            btnCopyAppsScript.addEventListener('click', () => {
                const scriptCode = `// Script Google Apps Sinkronisasi 2-Arah Restoran Mawar Sharon
function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Daftar Harga Menu");
    if (!sheet) return responseJSON({status: "error", message: "Sheet tidak ditemukan"});

    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) { payload = e.parameter || {}; }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    var action = payload.action || "PING";
    var data = payload.data || {};
    if (typeof data === "string") { try { data = JSON.parse(data); } catch (err) {} }

    if (action === "PING" || action === "TEST") {
      return responseJSON({status: "success", message: "Koneksi Webhook OK!"});
    }

    if (sheet.getLastColumn() < 5 || !sheet.getRange(1, 5).getValue().toString().trim()) {
      sheet.getRange(1, 5).setValue("Stok");
    }

    var values = sheet.getDataRange().getValues();
    var targetRow = -1;
    var searchName = (data.name || "").toString().trim().toLowerCase();

    for (var i = 1; i < values.length; i++) {
      if ((values[i][1] || "").toString().trim().toLowerCase() === searchName) {
        targetRow = i + 1;
        break;
      }
    }

    if (action === "UPDATE_ITEM" || action === "TOGGLE_STOCK" || action === "UPDATE_PRICE") {
      if (targetRow > 0) {
        if (data.hargaDasar !== undefined && data.hargaDasar !== null && data.hargaDasar !== "") {
          sheet.getRange(targetRow, 3).setValue("Rp" + Number(data.hargaDasar).toLocaleString("id-ID"));
        }
        if (data.hargaPajak !== undefined && data.hargaPajak !== null && data.hargaPajak !== "") {
          sheet.getRange(targetRow, 4).setValue("Rp" + Number(data.hargaPajak).toLocaleString("id-ID"));
        }
        if (data.stok !== undefined && data.stok !== null && data.stok !== "") {
          var stokStr = (data.stok.toString().toLowerCase() === "habis") ? "Habis" : "Ada";
          sheet.getRange(targetRow, 5).setValue(stokStr);
        }
      } else {
        sheet.appendRow(["", data.name, "Rp" + Number(data.hargaDasar || 0).toLocaleString("id-ID"), "Rp" + Number(data.hargaPajak || 0).toLocaleString("id-ID"), (data.stok === "habis" ? "Habis" : "Ada")]);
      }
      return responseJSON({status: "success", menu: data.name});
    }

    if (action === "ADD_ITEM") {
      sheet.appendRow(["", data.name, "Rp" + Number(data.hargaDasar || 0).toLocaleString("id-ID"), "Rp" + Number(data.hargaPajak || 0).toLocaleString("id-ID"), (data.stok === "habis" ? "Habis" : "Ada")]);
      return responseJSON({status: "success", menu: data.name});
    }

    return responseJSON({status: "unknown_action"});
  } catch (err) {
    return responseJSON({status: "error", error: err.toString()});
  } finally {
    lock.releaseLock();
  }
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(scriptCode).then(() => {
                        showToast('📋 Script Google Apps berhasil disalin ke clipboard!', 'success');
                    }).catch(() => {
                        prompt('Salin kode script di bawah:', scriptCode);
                    });
                } else {
                    prompt('Salin kode script di bawah:', scriptCode);
                }
            });
        }

        // Theme Switcher Controls (Terang / Gelap)
        const themeToggleBtn = $('#theme-toggle-btn');
        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', toggleTheme);
        }

        const btnThemeDark = $('#btn-theme-dark');
        if (btnThemeDark) {
            btnThemeDark.addEventListener('click', () => applyTheme('dark'));
        }

        const btnThemeLight = $('#btn-theme-light');
        if (btnThemeLight) {
            btnThemeLight.addEventListener('click', () => applyTheme('light'));
        }

        // Auto-refresh when user switches back to browser tab from Google Sheets
        window.addEventListener('focus', async () => {
            const ok = await fetchAllData();
            if (ok && (currentPage === 'menu' || currentPage === 'dashboard' || currentPage === 'omset')) {
                renderPageContent(currentPage);
            }
        });

        // Generic Modal Close Handler (buttons with .btn-close-modal or backdrop click)
        $$('.btn-close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal-backdrop');
                if (modal) modal.classList.add('hidden');
            });
        });

        $$('.modal-backdrop').forEach(backdrop => {
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) {
                    backdrop.classList.add('hidden');
                }
            });
        });

        // Real-time synchronization across browser tabs/windows
        if (realtimeChannel) {
            realtimeChannel.onmessage = (event) => {
                if (event.data && (event.data.type === 'MENU_UPDATE' || event.data.type === 'MENU_RESET')) {
                    if (currentPage === 'menu') renderMenuPage(currentMenuFilter);
                    if (currentPage === 'dashboard') renderDashboardStats();
                    showToast('Stok / harga menu diperbarui secara real-time!', 'info');
                }
            };
        }

        window.addEventListener('storage', (e) => {
            if (e.key === STORAGE_MENU_KEY) {
                if (currentPage === 'menu') renderMenuPage(currentMenuFilter);
                if (currentPage === 'dashboard') renderDashboardStats();
            }
        });

        // Laporan form
        $('#laporan-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const tanggal = $('#laporan-tanggal').value;
            const pendapatan = parseInt($('#laporan-pendapatan').value) || 0;
            const bahan = parseInt($('#laporan-bahan').value) || 0;
            const operasional = parseInt($('#laporan-operasional').value) || 0;
            const makananSold = parseInt($('#laporan-makanan-sold').value) || 0;
            const minumanSold = parseInt($('#laporan-minuman-sold').value) || 0;
            const catatan = $('#laporan-catatan').value.trim();

            if (!tanggal) {
                showToast('Tanggal harus diisi!', 'error');
                return;
            }

            const laporan = getLaporan();
            laporan.push({
                tanggal,
                pendapatan,
                bahan,
                operasional,
                makananSold,
                minumanSold,
                catatan,
                createdAt: new Date().toISOString()
            });
            saveLaporan(laporan);

            // Sinkronisasi otomatis ke Google Sheets Webhook (semua tabel terhubung: Laporan Keuangan & Sheet Omset Bulan Terkait)
            syncToWebhook('SYNC_LAPORAN', {
                tanggal,
                pendapatan,
                bahan,
                operasional,
                makananSold,
                minumanSold,
                catatan
            });

            // Reset form
            $('#laporan-form').reset();
            $('#laporan-tanggal').value = new Date().toISOString().split('T')[0];

            renderLaporanPage();
            // Perbarui juga data omset dan dashboard jika bulan yang bersangkutan sedang ditampilkan
            if (currentPage === 'omset') renderOmsetPage();
            if (currentPage === 'dashboard') {
                renderDashboardStats();
                renderMenuTopPreview();
            }
            if (currentPage === 'analisis') renderAnalisisPage();

            showToast('Laporan berhasil disimpan & disinkronkan ke spreadsheet!', 'success');
        });

        // Delete individual laporan
        $('#laporan-tbody').addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-delete-row');
            if (!btn) return;
            const idx = parseInt(btn.dataset.index);
            const filterMonth = $('#laporan-month-filter') ? $('#laporan-month-filter').value : 'all';
            let allLaporan = getLaporan().sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

            if (filterMonth !== 'all') {
                const targetItem = allLaporan.filter(l => (l.tanggal || '').startsWith(filterMonth))[idx];
                if (targetItem) {
                    const realIdx = allLaporan.findIndex(l => l.tanggal === targetItem.tanggal && l.createdAt === targetItem.createdAt);
                    if (realIdx >= 0 && confirm('Hapus laporan ini?')) {
                        allLaporan.splice(realIdx, 1);
                        saveLaporan(allLaporan);
                        renderLaporanPage();
                        showToast('Laporan dihapus.', 'info');
                    }
                }
            } else {
                if (idx >= 0 && idx < allLaporan.length && confirm('Hapus laporan ini?')) {
                    allLaporan.splice(idx, 1);
                    saveLaporan(allLaporan);
                    renderLaporanPage();
                    showToast('Laporan dihapus.', 'info');
                }
            }
        });

        // Delete all laporan
        $('#btn-delete-all').addEventListener('click', () => {
            const laporan = getLaporan();
            if (laporan.length === 0) {
                showToast('Tidak ada laporan untuk dihapus.', 'info');
                return;
            }
            if (confirm('Hapus SEMUA laporan keuangan? Tindakan ini tidak dapat dibatalkan.')) {
                saveLaporan([]);
                renderLaporanPage();
                if (currentPage === 'dashboard') renderDashboardStats();
                showToast('Semua laporan dihapus.', 'info');
            }
        });

        // Export Laporan CSV
        $('#btn-export-laporan').addEventListener('click', () => {
            const laporan = getLaporan().sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
            if (laporan.length === 0) {
                showToast('Tidak ada data untuk diexport.', 'error');
                return;
            }

            const headers = ['Tanggal', 'Pendapatan', 'Biaya Bahan', 'Biaya Operasional', 'Keuntungan', 'Makanan Terjual', 'Minuman Terjual', 'Catatan'];
            const rows = laporan.map(l => {
                const keuntungan = (l.pendapatan || 0) - (l.bahan || 0) - (l.operasional || 0);
                return [
                    l.tanggal,
                    l.pendapatan,
                    l.bahan,
                    l.operasional,
                    keuntungan,
                    l.makananSold || 0,
                    l.minumanSold || 0,
                    `"${(l.catatan || '').split('"').join('""')}"`
                ].join(',');
            });

            downloadCSV(`laporan_keuangan_mawar_sharon_${new Date().toISOString().split('T')[0]}.csv`, [headers.join(','), ...rows].join('\n'));
            showToast('File CSV Laporan berhasil diunduh!', 'success');
        });

        // Keyboard shortcut: Escape to close sidebar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeSidebar();
        });
    }

    // Helper: Trigger CSV download
    function downloadCSV(filename, content) {
        const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ============================================
    // SET CURRENT DATE
    // ============================================

    function setCurrentDate() {
        const now = new Date();
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        const topbarDate = $('#topbar-date');
        if (topbarDate) topbarDate.textContent = now.toLocaleDateString('id-ID', options);

        const dateInput = $('#laporan-tanggal');
        if (dateInput) dateInput.value = now.toISOString().split('T')[0];

        const omsetDateInput = $('#input-omset-tgl');
        if (omsetDateInput) omsetDateInput.value = now.toISOString().split('T')[0];
    }

    // ============================================
    // AUTO REFRESH
    // ============================================

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(async () => {
            const ok = await fetchAllData();
            if (ok) {
                renderPageContent(currentPage);
            }
        }, REFRESH_INTERVAL);
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    async function init() {
        applyTheme(getCurrentTheme());
        setCurrentDate();
        setupEventListeners();
        updateMenuSyncBadge();

        // Fetch initial data
        const ok = await fetchAllData();

        // Hide loading screen
        setTimeout(() => {
            const loader = $('#loading-screen');
            if (loader) loader.classList.add('hidden');
        }, ok ? 600 : 1800);

        if (ok) {
            renderPageContent('dashboard');
            showToast('Data Google Sheets & Omset Restoran berhasil dimuat!', 'success');
        } else {
            renderPageContent('dashboard');
        }

        // Start auto-refresh
        startAutoRefresh();
    }

    // Start the app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
