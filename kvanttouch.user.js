// ==UserScript==
// @name         ((квантtouch))
// @namespace    https://moveonwasd.github.io/kvanttouch/
// @version      1.2.0
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

    function gmFetchJson(url, validateFn) {
        return new Promise((resolve) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 12000,
                    anonymous: false,
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
                                // Some APIs return 200 with an auth error JSON
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

    async function fetchAllTodayData(targetDateStr) {
        const { today, tomorrow } = getLocalDateStrings(targetDateStr);

        const crmUrl = `https://codeclassonline.s20.online/teacher/1/calendar/fetch?start=${today}&end=${tomorrow}&page=1`;
        const erpStudyUrl = `https://erp.kvantastica.ru/api/admin/teacher/study?page=1`;
        const erpArchiveUrl = `https://erp.kvantastica.ru/api/admin/teacher/study/archive?page=1`;

        const [crm, erpStudy, erpArchive] = await Promise.all([
            gmFetchJson(crmUrl, isCrmValid),
            gmFetchJson(erpStudyUrl, isErpValid),
            gmFetchJson(erpArchiveUrl, isErpValid)
        ]);

        // Paginate ERP study only if page 1 ends on or before target date
        if (erpStudy.ok && erpStudy.data.links && erpStudy.data.links.next && erpStudy.data.data.length > 0) {
            const lastItem = erpStudy.data.data[erpStudy.data.data.length - 1];
            const lastDate = (lastItem.date_start || '').slice(0, 10);
            if (!lastDate || lastDate <= today) {
                const p2 = await gmFetchJson(erpStudy.data.links.next, isErpValid);
                if (p2.ok) erpStudy.data.data = erpStudy.data.data.concat(p2.data.data);
            }
        }

        // Paginate ERP archive only if page 1 last item is still >= target date
        if (erpArchive.ok && erpArchive.data.links && erpArchive.data.links.next && erpArchive.data.data.length > 0) {
            const lastItem = erpArchive.data.data[erpArchive.data.data.length - 1];
            const lastDate = (lastItem.date_start || '').slice(0, 10);
            if (!lastDate || lastDate >= today) {
                const p2 = await gmFetchJson(erpArchive.data.links.next, isErpValid);
                if (p2.ok) erpArchive.data.data = erpArchive.data.data.concat(p2.data.data);
            }
        }

        return {
            date: today,
            crm,
            erpStudy,
            erpArchive
        };
    }

    if (host.includes('github.io')) {
        const announceReady = () => {
            window.postMessage({
                source: 'KVANT_BRIDGE',
                type: 'BRIDGE_READY',
                version: (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.version : '1.2.0'
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
})();
