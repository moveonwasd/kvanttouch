// ==UserScript==
// @name         (( квантtouch ))
// @namespace    https://moveonwasd.github.io/kvanttouch/
// @version      1.0.0
// @description  Автоматизация и синхронизация кабинета преподавателя Квантастики (AlfaCRM, ERP, Контур.Толк, Битрикс24)
// @author       Kvantastica
// @match        https://moveonwasd.github.io/kvanttouch/*
// @match        https://*.alfacrm.pro/*
// @match        https://*.s20.online/*
// @match        https://*.ktalk.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const origin = window.location.origin;

    // 1. ДАШБОРД (GitHub Pages)
    if (origin.includes('github.io') || window.location.pathname.endsWith('index.html')) {
        console.log('[квантtouch] Запущен на дашборде');

        // Слушаем команды от интерфейса страницы
        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'KVANT_TOUCH_UI') {
                console.log('[квантtouch] Команда от UI:', event.data);
                GM_setValue('kvant_command', {
                    ...event.data,
                    timestamp: Date.now()
                });
            }
        });

        // Передаем статус скрипта странице
        window.postMessage({ source: 'KVANT_TOUCH_SCRIPT', status: 'ACTIVE' }, '*');
    }

    // 2. ALFACRM
    else if (origin.includes('alfacrm') || origin.includes('s20.online')) {
        console.log('[квантtouch] Запущен в AlfaCRM');
        
        // Слушаем команды на проведение урока / сброс галочек
        GM_addValueChangeListener('kvant_command', (name, oldVal, newVal, remote) => {
            if (newVal && newVal.action === 'CONDUCT_LESSON') {
                console.log('[квантtouch] Проведение урока в AlfaCRM...', newVal);
            }
        });
    }

    // 3. КОНТУР.ТОЛК
    else if (origin.includes('ktalk.ru')) {
        console.log('[квантtouch] Запущен в Контур.Толк');

        // Логика захвата ссылки на последнюю запись из /materials
    }

})();
