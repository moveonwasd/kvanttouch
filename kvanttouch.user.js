// ==UserScript==
// @name         ((квантtouch))
// @namespace    https://moveonwasd.github.io/kvanttouch/
// @version      1.1.1
// @description  Мост для синхронизации AlfaCRM, ERP Квантастика и Контур.Толк в едином интерфейсе ((квантtouch))
// @author       Kvantastica
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
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const host = window.location.hostname;

    function gmFetchJson(url) {
        return new Promise((resolve) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 12000,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest'
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
                            resolve({ ok: false, authRequired: true, status: res.status, finalUrl });
                            return;
                        }

                        if (res.status < 200 || res.status >= 300) {
                            resolve({ ok: false, authRequired: false, status: res.status, error: `HTTP ${res.status}` });
                            return;
                        }

                        try {
                            const json = JSON.parse(text);
                            resolve({ ok: true, data: json });
                        } catch (e) {
                            resolve({ ok: false, authRequired: false, error: 'Invalid JSON response' });
                        }
                    },
                    onerror: function () {
                        resolve({ ok: false, authRequired: false, error: 'Network error' });
                    },
                    ontimeout: function () {
                        resolve({ ok: false, authRequired: false, error: 'Timeout (12s)' });
                    },
                    onabort: function () {
                        resolve({ ok: false, authRequired: false, error: 'Aborted' });
                    }
                });
            } catch (err) {
                resolve({ ok: false, authRequired: false, error: String(err) });
            }
        });
    }

    function getLocalDateStrings() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const format = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return {
            today: format(now),
            tomorrow: format(tomorrow)
        };
    }

    async function fetchAllTodayData(targetDateStr) {
        let today = targetDateStr;
        let tomorrow;

        if (today) {
            const parts = today.split('-').map(Number);
            const d = new Date(parts[0], parts[1] - 1, parts[2] + 1);
            const pad = (n) => String(n).padStart(2, '0');
            tomorrow = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        } else {
            const dates = getLocalDateStrings();
            today = dates.today;
            tomorrow = dates.tomorrow;
        }

        const crmUrl = `https://codeclassonline.s20.online/teacher/1/calendar/fetch?start=${today}&end=${tomorrow}&page=1`;
        const erpStudyUrl = `https://erp.kvantastica.ru/api/admin/teacher/study?page=1`;
        const erpArchiveUrl = `https://erp.kvantastica.ru/api/admin/teacher/study/archive?page=1`;

        const [crm, erpStudy, erpArchive] = await Promise.all([
            gmFetchJson(crmUrl),
            gmFetchJson(erpStudyUrl),
            gmFetchJson(erpArchiveUrl)
        ]);

        if (erpStudy.ok && erpStudy.data && erpStudy.data.links && erpStudy.data.links.next) {
            const p2 = await gmFetchJson(erpStudy.data.links.next);
            if (p2.ok && p2.data && Array.isArray(p2.data.data)) {
                erpStudy.data.data = erpStudy.data.data.concat(p2.data.data);
            }
        }
        if (erpArchive.ok && erpArchive.data && erpArchive.data.links && erpArchive.data.links.next) {
            const p2 = await gmFetchJson(erpArchive.data.links.next);
            if (p2.ok && p2.data && Array.isArray(p2.data.data)) {
                erpArchive.data.data = erpArchive.data.data.concat(p2.data.data);
            }
        }

        return {
            date: today,
            crm,
            erpStudy,
            erpArchive
        };
    }

    // 1. DASHBOARD (GitHub Pages)
    if (host.includes('github.io')) {
        console.log('[квантtouch] Мост инициализирован на дашборде');

        const announceReady = () => {
            window.postMessage({
                source: 'KVANT_BRIDGE',
                type: 'BRIDGE_READY',
                version: (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.version : '1.1.1'
            }, '*');
        };

        // Note: Do NOT check event.source === window because Tampermonkey runs in a sandbox Proxy!
        window.addEventListener('message', async (event) => {
            if (event.origin !== window.location.origin) return;
            if (!event.data || event.data.source !== 'KVANT_UI') return;

            const msg = event.data;
            if (msg.type === 'PING') {
                announceReady();
            } else if (msg.type === 'FETCH_TODAY') {
                console.log('[квантtouch] Запрос данных за', msg.date);
                try {
                    const payload = await fetchAllTodayData(msg.date);
                    console.log('[квантtouch] Ответы получены:', {
                        crmOk: payload.crm?.ok,
                        crmAuth: payload.crm?.authRequired,
                        erpStudyOk: payload.erpStudy?.ok,
                        erpStudyAuth: payload.erpStudy?.authRequired,
                        erpArchiveOk: payload.erpArchive?.ok
                    });
                    window.postMessage({
                        source: 'KVANT_BRIDGE',
                        type: 'TODAY_DATA',
                        requestId: msg.requestId,
                        payload
                    }, '*');
                } catch (err) {
                    console.error('[квантtouch] Ошибка загрузки:', err);
                    window.postMessage({
                        source: 'KVANT_BRIDGE',
                        type: 'TODAY_DATA',
                        requestId: msg.requestId,
                        payload: {
                            date: msg.date,
                            crm: { ok: false, error: String(err) },
                            erpStudy: { ok: false, error: String(err) },
                            erpArchive: { ok: false, error: String(err) }
                        }
                    }, '*');
                }
            }
        });

        announceReady();
    }
})();
