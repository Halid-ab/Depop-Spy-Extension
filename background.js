(function() {
    'use strict';

    const SEARCH_TIMEOUT_MS = 20000;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== 'PRICE_SPY_FETCH_SEARCH_DATA') return;

        fetchSearchData(message.query)
            .then(sendResponse)
            .catch(error => sendResponse({
                ok: false,
                error: error?.message || String(error),
                soldData: null,
                activeData: null
            }));

        return true;
    });

    async function fetchSearchData(query) {
        if (!query) {
            return { ok: true, soldData: null, activeData: null };
        }

        const encodedQuery = encodeURIComponent(query);
        const soldUrl = `https://www.depop.com/search/?q=${encodedQuery}&sold=true`;
        const activeUrl = `https://www.depop.com/search/?q=${encodedQuery}`;

        const [soldResult, activeResult] = await Promise.all([
            openSearchWindowAndExtract(soldUrl),
            openSearchWindowAndExtract(activeUrl),
        ]);

        return {
            ok: true,
            soldData: soldResult,
            activeData: activeResult
        };
    }

    async function openSearchWindowAndExtract(url) {
        let createdWindow = null;

        try {
            createdWindow = await chrome.windows.create({
                url,
                type: 'popup',
                width: 1,
                height: 1,
                left: -100,
                top: -100,
                focused: false
            });

            const tab = createdWindow?.tabs?.[0];
            if (!tab?.id) {
                throw new Error('Failed to create search tab');
            }

            await waitForTabComplete(tab.id);
            return await requestNextDataFromTab(tab.id);
        } finally {
            if (createdWindow?.id !== undefined) {
                try {
                    await chrome.windows.remove(createdWindow.id);
                } catch (error) {}
            }
        }
    }

    function waitForTabComplete(tabId) {
        return new Promise((resolve, reject) => {
            let finished = false;

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for tab ${tabId} to load`));
            }, SEARCH_TIMEOUT_MS);

            const cleanup = () => {
                finished = true;
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(handleUpdated);
                chrome.tabs.onRemoved.removeListener(handleRemoved);
            };

            const handleRemoved = removedTabId => {
                if (removedTabId !== tabId || finished) return;
                cleanup();
                reject(new Error(`Tab ${tabId} closed before loading finished`));
            };

            const handleUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId !== tabId || finished) return;
                if (changeInfo.status === 'complete') {
                    cleanup();
                    resolve();
                }
            };

            chrome.tabs.onUpdated.addListener(handleUpdated);
            chrome.tabs.onRemoved.addListener(handleRemoved);

            chrome.tabs.get(tabId, tab => {
                if (finished) return;

                if (chrome.runtime.lastError) {
                    cleanup();
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (tab?.status === 'complete') {
                    cleanup();
                    resolve();
                }
            });
        });
    }

    async function requestNextDataFromTab(tabId) {
        let lastError = null;

        for (let attempt = 0; attempt < 10; attempt++) {
            try {
                return await sendExtractionMessage(tabId);
            } catch (error) {
                lastError = error;
                await delay(250);
            }
        }

        throw lastError || new Error('Failed to extract search data');
    }

    function sendExtractionMessage(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { type: 'PRICE_SPY_EXTRACT_NEXT_DATA' }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (!response?.ok) {
                    reject(new Error(response?.error || 'Failed to extract search data'));
                    return;
                }

                resolve(response.data);
            });
        });
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
})();
