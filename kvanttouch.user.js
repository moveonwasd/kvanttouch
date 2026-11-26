// ==UserScript==
// @name         ((квантtouch))
// @namespace    https://moveonwasd.github.io/kvanttouch/
// @version      1.2.2
// @description  Мост для синхронизации AlfaCRM, ERP Квантастика и Контур.Толк в едином интерфейсе ((квантtouch))
// @author       Kvantastica
// @updateURL    https://moveonwasd.github.io/kvanttouch/kvanttouch.user.js
// @downloadURL  https://moveonwasd.github.io/kvanttouch/kvanttouch.user.js
// @match        https://moveonwasd.github.io/kvanttouch/*
// @match        https://codeclassonline.s20.online/*
// @match        https://erp.kvantastica.ru/*
// @match        https://*.ktalk.ru/*
// @connect      codeclassonline.s20.online
// @connect      erp.kvantastica.ru
// @connect      ktalk.ru
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const host = window.location.hostname;
    const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.version : '1.2.2';

    function gmFetchJson(url, validateFn, customHeaders = {}) {
        return new Promise((resolve) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 12000,
                    anonymous: false,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest',
                        ...customHeaders
                    },
                    onload: function (res) {
                        const finalUrl = res.finalUrl || url;
                        const text = (res.responseText || '').trim();

                        if (
                            finalUrl.includes('/login') ||
                            finalUrl.includes('/auth') ||
                            res.status === 401 ||
                            res.status === 403 ||
                            text.startsWith('<!DOCTYPE') ||
                            text.startsWith('<html')
                        ) {
                            resolve({ ok: false, authRequired: true, unreachable: false, status: res.status, finalUrl });
                            return;
                        }

                        if (res.status < 200 || res.status >= 300) {
                            resolve({ ok: false, authRequired: false, unreachable: true, status: res.status, error: `HTTP ${res.status}` });
                            return;
                        }

                        try {
                            const json = JSON.parse(text);
                            if (validateFn && !validateFn(json)) {
                                if (json && (json.message === 'Unauthenticated.' || json.error === 'Unauthorized')) {
                                    resolve({ ok: false, authRequired: true, unreachable: false, status: 401 });
                                } else {
                                    resolve({ ok: false, authRequired: false, unreachable: true, error: 'Неожиданный формат ответа' });
                                }
                                return;
                            }
                            resolve({ ok: true, authRequired: false, unreachable: false, data: json });
                        } catch (e) {
                            resolve({ ok: false, authRequired: false, unreachable: true, error: 'Ответ не является JSON' });
                        }
                    },
                    onerror: function () {
                        resolve({ ok: false, authRequired: false, unreachable: true, error: 'Сервер недоступен (ошибка сети)' });
                    },
                    ontimeout: function () {
                        resolve({ ok: false, authRequired: false, unreachable: true, error: 'Таймаут ответа (12с)' });
                    },
                    onabort: function () {
                        resolve({ ok: false, authRequired: false, unreachable: true, error: 'Запрос прерван' });
                    }
                });
            } catch (err) {
                resolve({ ok: false, authRequired: false, unreachable: true, error: String(err) });
            }
        });
    }

    function getLocalDateStrings(targetDateStr) {
        const pad = (n) => String(n).padStart(2, '0');
        let d;
        if (targetDateStr) {
            const parts = targetDateStr.split('-').map(Number);
            d = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
            d = new Date();
        }
        const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        const tomorrow = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
        return { today, tomorrow };
    }

    const isCrmValid = (j) => j && Array.isArray(j.collection);
    const isErpValid = (j) => j && Array.isArray(j.data);

    const erpHeaders = {
        'Referer': 'https://erp.kvantastica.ru/admin/teacher-study',
        'Origin': 'https://erp.kvantastica.ru'
    };

    const crmHeaders = {
        'Referer': 'https://codeclassonline.s20.online/teacher/1/calendar/index',
        'Origin': 'https://codeclassonline.s20.online'
    };

    /**
     * Same-origin fetch fallback via open ERP tab or brief silent background tab.
     */
    function fetchErpViaTabBridge(today) {
        return new Promise((resolve) => {
            const reqId = `erp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            let settled = false;
            let bgTab = null;
            let listenerId = null;
            let openFallbackTimer = null;
            let hardTimeout = null;

            const cleanup = () => {
                if (listenerId !== null) {
                    try { GM_removeValueChangeListener(listenerId); } catch (e) {}
                }
                if (openFallbackTimer) clearTimeout(openFallbackTimer);
                if (hardTimeout) clearTimeout(hardTimeout);
                if (bgTab && typeof bgTab.close === 'function') {
                    try { bgTab.close(); } catch (e) {}
                }
            };

            listenerId = GM_addValueChangeListener('kvant_erp_res', (name, oldVal, newVal) => {
                if (settled || !newVal || newVal.reqId !== reqId) return;
                settled = true;
                cleanup();
                resolve({ erpStudy: newVal.erpStudy, erpArchive: newVal.erpArchive });
            });

            // Step 1: Ping any already-open ERP tab
            GM_setValue('kvant_erp_req', { reqId, today, ts: Date.now() });

            // Step 2: If no open ERP tab answered in 900ms, briefly open background tab
            openFallbackTimer = setTimeout(() => {
                if (settled) return;
                if (typeof GM_openInTab === 'function') {
                    try {
                        bgTab = GM_openInTab(`https://erp.kvantastica.ru/admin/teacher-study#kvant_sync=${reqId}&date=${today}`, {
                            active: false,
                            insert: false,
                            setParent: true
                        });
                    } catch (e) {
                        console.warn('[квантtouch] GM_openInTab failed:', e);
                    }
                }
            }, 900);

            // Safety timeout (10s)
            hardTimeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(null);
            }, 10000);
        });
    }

    async function fetchAllTodayData(targetDateStr) {
        const { today, tomorrow } = getLocalDateStrings(targetDateStr);

        const crmUrl = `https://codeclassonline.s20.online/teacher/1/calendar/fetch?start=${today}&end=${tomorrow}&page=1`;
        const erpStudyUrl = `https://erp.kvantastica.ru/api/admin/teacher/study?page=1`;
        const erpArchiveUrl = `https://erp.kvantastica.ru/api/admin/teacher/study/archive?page=1`;

        let [crm, erpStudy, erpArchive] = await Promise.all([
            gmFetchJson(crmUrl, isCrmValid, crmHeaders),
            gmFetchJson(erpStudyUrl, isErpValid, erpHeaders),
            gmFetchJson(erpArchiveUrl, isErpValid, erpHeaders)
        ]);

        if (erpStudy.ok && erpStudy.data.links && erpStudy.data.links.next && erpStudy.data.data.length > 0) {
            const lastDate = (erpStudy.data.data[erpStudy.data.data.length - 1].date_start || '').slice(0, 10);
            if (!lastDate || lastDate <= today) {
                const p2 = await gmFetchJson(erpStudy.data.links.next, isErpValid, erpHeaders);
                if (p2.ok) erpStudy.data.data = erpStudy.data.data.concat(p2.data.data);
            }
        }
        if (erpArchive.ok && erpArchive.data.links && erpArchive.data.links.next && erpArchive.data.data.length > 0) {
            const lastDate = (erpArchive.data.data[erpArchive.data.data.length - 1].date_start || '').slice(0, 10);
            if (!lastDate || lastDate >= today) {
                const p2 = await gmFetchJson(erpArchive.data.links.next, isErpValid, erpHeaders);
                if (p2.ok) erpArchive.data.data = erpArchive.data.data.concat(p2.data.data);
            }
        }

        // If ERP GM_xmlhttpRequest failed auth, try same-origin ERP tab bridge
        if ((!erpStudy.ok && erpStudy.authRequired) || (!erpArchive.ok && erpArchive.authRequired)) {
            console.log('[квантtouch] GM_xmlhttpRequest к ERP получил authRequired, запускаю same-origin мост...');
            const tabRes = await fetchErpViaTabBridge(today);
            if (tabRes) {
                erpStudy = tabRes.erpStudy;
                erpArchive = tabRes.erpArchive;
            }
        }

        return {
            date: today,
            scriptVersion: SCRIPT_VERSION,
            crm,
            erpStudy,
            erpArchive
        };
    }

    // =========================================================================
    // ROLE 1: DASHBOARD (GitHub Pages)
    // =========================================================================
    if (host.includes('github.io')) {
        const announceReady = () => {
            window.postMessage({
                source: 'KVANT_BRIDGE',
                type: 'BRIDGE_READY',
                version: SCRIPT_VERSION
            }, '*');
        };

        window.addEventListener('message', async (event) => {
            if (event.origin !== window.location.origin) return;
            if (!event.data || event.data.source !== 'KVANT_UI') return;

            const msg = event.data;
            if (msg.type === 'PING') {
                announceReady();
            } else if (msg.type === 'FETCH_TODAY') {
                try {
                    const payload = await fetchAllTodayData(msg.date);
                    window.postMessage({
                        source: 'KVANT_BRIDGE',
                        type: 'TODAY_DATA',
                        requestId: msg.requestId,
                        payload
                    }, '*');
                } catch (err) {
                    window.postMessage({
                        source: 'KVANT_BRIDGE',
                        type: 'TODAY_DATA',
                        requestId: msg.requestId,
                        payload: {
                            date: msg.date,
                            scriptVersion: SCRIPT_VERSION,
                            crm: { ok: false, unreachable: true, error: String(err) },
                            erpStudy: { ok: false, unreachable: true, error: String(err) },
                            erpArchive: { ok: false, unreachable: true, error: String(err) }
                        }
                    }, '*');
                }
            }
        });

        announceReady();
    }

    // =========================================================================
    // ROLE 2: ERP WORKER (Same-origin fetch inside erp.kvantastica.ru)
    // =========================================================================
    else if (host.includes('erp.kvantastica.ru')) {
        function getCookie(name) {
            const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
            return match ? decodeURIComponent(match[1]) : null;
        }

        async function sameOriginErpFetch(url) {
            try {
                const headers = {
                    'Accept': 'application/json, text/plain, */*',
                    'X-Requested-With': 'XMLHttpRequest'
                };
                const csrfMeta = document.querySelector('meta[name="csrf-token"]');
                if (csrfMeta && csrfMeta.content) {
                    headers['X-CSRF-TOKEN'] = csrfMeta.content;
                }
                const xsrf = getCookie('XSRF-TOKEN');
                if (xsrf) {
                    headers['X-XSRF-TOKEN'] = xsrf;
                }

                const res = await fetch(url, {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers
                });
                if (res.redirected && res.url.includes('/login')) {
                    return { ok: false, authRequired: true, status: 401 };
                }
                if (res.status === 401 || res.status === 403) {
                    return { ok: false, authRequired: true, status: res.status };
                }
                if (!res.ok) {
                    return { ok: false, unreachable: true, status: res.status, error: `HTTP ${res.status}` };
                }
                const text = await res.text();
                if (text.trim().startsWith('<')) {
                    return { ok: false, authRequired: true, status: 401 };
                }
                const json = JSON.parse(text);
                if (!isErpValid(json)) {
                    return { ok: false, unreachable: true, error: 'Неожиданный формат ERP' };
                }
                return { ok: true, authRequired: false, data: json };
            } catch (err) {
                return { ok: false, unreachable: true, error: String(err) };
            }
        }

        async function runErpSync(reqId, today) {
            if (window.location.pathname.includes('/login')) {
                GM_setValue('kvant_erp_res', {
                    reqId,
                    erpStudy: { ok: false, authRequired: true },
                    erpArchive: { ok: false, authRequired: true }
                });
                return;
            }

            const [erpStudy, erpArchive] = await Promise.all([
                sameOriginErpFetch('/api/admin/teacher/study?page=1'),
                sameOriginErpFetch('/api/admin/teacher/study/archive?page=1')
            ]);

            if (erpStudy.ok && erpStudy.data.links && erpStudy.data.links.next && erpStudy.data.data.length > 0) {
                const lastDate = (erpStudy.data.data[erpStudy.data.data.length - 1].date_start || '').slice(0, 10);
                if (!lastDate || lastDate <= today) {
                    const nextUrl = new URL(erpStudy.data.links.next);
                    const p2 = await sameOriginErpFetch(nextUrl.pathname + nextUrl.search);
                    if (p2.ok) erpStudy.data.data = erpStudy.data.data.concat(p2.data.data);
                }
            }
            if (erpArchive.ok && erpArchive.data.links && erpArchive.data.links.next && erpArchive.data.data.length > 0) {
                const lastDate = (erpArchive.data.data[erpArchive.data.data.length - 1].date_start || '').slice(0, 10);
                if (!lastDate || lastDate >= today) {
                    const nextUrl = new URL(erpArchive.data.links.next);
                    const p2 = await sameOriginErpFetch(nextUrl.pathname + nextUrl.search);
                    if (p2.ok) erpArchive.data.data = erpArchive.data.data.concat(p2.data.data);
                }
            }

            GM_setValue('kvant_erp_res', { reqId, erpStudy, erpArchive });
        }

        const hash = window.location.hash || '';
        if (hash.includes('kvant_sync=')) {
            const params = new URLSearchParams(hash.slice(1));
            const reqId = params.get('kvant_sync');
            const today = params.get('date') || getLocalDateStrings().today;
            runErpSync(reqId, today).then(() => {
                setTimeout(() => {
                    try { window.close(); } catch (e) {}
                }, 150);
            });
        } else {
            GM_addValueChangeListener('kvant_erp_req', (name, oldVal, newVal, remote) => {
                if (!remote || !newVal || !newVal.reqId) return;
                runErpSync(newVal.reqId, newVal.today || getLocalDateStrings().today);
            });
        }
    }
})();
