/**
 * Depop Price Spy - Content Script (Fixed)
 */

(function() {
    'use strict';

    // --- Utility Functions ---

    function parsePrice(priceStr) {
        if (!priceStr) return 0;
        const numeric = String(priceStr).replace(/[^0-9.]/g, '');
        return parseFloat(numeric) || 0;
    }

    function formatCurrency(value, originalStr) {
        const symbol = (originalStr || '$').match(/[^\d.,\s]/)?.[0] || '$';
        return symbol + value.toFixed(2);
    }

    function calculateDaysFromDate(date) {
        const diffTime = Math.abs(new Date() - date);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    function getColorFromTitle(title) {
        const colors = ['#ff4e00','#3b82f6','#22c55e','#eab308','#8b5cf6','#ec4899'];
        let hash = 0;
        for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    // --- Price extraction: handles all known Depop formats ---

    function extractPriceValue(item) {
        // Format 1: { price: { priceAmount: "25.00" } }
        if (item?.price?.priceAmount) return parseFloat(item.price.priceAmount);
        // Format 2: { priceAmount: "25.00" }
        if (item?.priceAmount) return parseFloat(item.priceAmount);
        // Format 3: { price: "25.00" } (string)
        if (item?.price && typeof item.price === 'string') return parsePrice(item.price);
        // Format 4: { price: 25 } (number)
        if (item?.price && typeof item.price === 'number') return item.price;
        // Format 5: { priceForBuyer: { amountCents: 2500 } }
        if (item?.priceForBuyer?.amountCents) return item.priceForBuyer.amountCents / 100;
        // Format 6: nested in displayItems or meta
        if (item?.meta?.price) return parsePrice(item.meta.price);
        return 0;
    }

    function extractCurrencySymbol(item) {
        return item?.price?.currencySymbol
            || item?.currencySymbol
            || item?.price?.currency === 'USD' ? '$'
            : item?.price?.currency === 'GBP' ? '£'
            : item?.price?.currency === 'EUR' ? '€'
            : '$';
    }

    // --- Data Extraction from __NEXT_DATA__ ---

    function extractNextData() {
        try {
            const script = document.getElementById('__NEXT_DATA__');
            if (script) return JSON.parse(script.textContent);
        } catch (e) {
            console.error("🕵️ Price Spy: Error parsing __NEXT_DATA__", e);
        }
        return null;
    }

    // FIXED: proper recursive search that correctly handles both objects and arrays
    function deepSearch(obj, predicate, visited = new Set(), depth = 0) {
        if (depth > 15 || !obj || typeof obj !== 'object' || visited.has(obj)) return null;
        visited.add(obj);

        const items = Array.isArray(obj) ? obj : Object.values(obj);
        for (const val of items) {
            if (val && typeof val === 'object') {
                if (predicate(val)) return val;
                const found = deepSearch(val, predicate, visited, depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    function isProductLike(obj) {
        const hasPrice = extractPriceValue(obj) > 0;
        const hasTitle = typeof obj.title === 'string' && obj.title.length > 0;
        const hasId = obj.id !== undefined || obj.slug !== undefined;
        return hasPrice && hasTitle && hasId;
    }

    function getListingFromNextData(nextData) {
        if (!nextData) return null;
        return deepSearch(nextData, isProductLike);
    }

    // FIXED: search results extraction with broader predicate
    function extractSearchResults(searchData) {
        if (!searchData) return [];

        // Try known paths first
        const paths = [
            searchData?.props?.pageProps?.initialState?.products?.results,
            searchData?.props?.pageProps?.products,
            searchData?.props?.pageProps?.initialData?.products,
            searchData?.props?.pageProps?.searchResults,
            searchData?.props?.pageProps?.data?.results,
            searchData?.props?.pageProps?.results,
        ];
        for (const path of paths) {
            if (Array.isArray(path) && path.length > 0 && extractPriceValue(path[0]) > 0) {
                console.log('🕵️ Price Spy: found results via path, count:', path.length);
                return path;
            }
        }

        // Fallback: find any array with 3+ price-bearing items
        function findArr(obj, visited = new Set(), depth = 0) {
            if (depth > 12 || !obj || typeof obj !== 'object' || visited.has(obj)) return null;
            visited.add(obj);
            if (Array.isArray(obj) && obj.length >= 3) {
                const sample = obj.slice(0, 3);
                if (sample.every(i => i && typeof i === 'object' && extractPriceValue(i) > 0)) {
                    return obj;
                }
            }
            for (const val of Object.values(obj)) {
                const found = findArr(val, visited, depth + 1);
                if (found) return found;
            }
            return null;
        }
        return findArr(searchData) || [];
    }

    // --- DOM Scraping Fallbacks ---

    function getDaysListed(nextData) {
        const product = getListingFromNextData(nextData);
        if (product?.dateListed) return calculateDaysFromDate(new Date(product.dateListed));
        if (product?.created) return calculateDaysFromDate(new Date(product.created));
        if (product?.listedAt) return calculateDaysFromDate(new Date(product.listedAt));
        const timeEl = document.querySelector('time[datetime]');
        if (timeEl) return calculateDaysFromDate(new Date(timeEl.getAttribute('datetime')));
        return "Unknown";
    }

    function getDemandSignals() {
        const text = document.body.innerText;
        const bagsMatch = text.match(/(\d+)\s+(?:people(?:'s)?|person(?:'s)?)\s+bag/i);
        const offersMatch = text.match(/(\d+)\s+offer/i);
        const bags = bagsMatch ? parseInt(bagsMatch[1]) : 0;
        const offers = offersMatch ? parseInt(offersMatch[1]) : 0;
        let heat = "Low", heatClass = "heat-low";
        if (bags > 10 || offers > 5) { heat = "Hot"; heatClass = "heat-hot"; }
        else if (bags > 3 || offers > 2) { heat = "Warm"; heatClass = "heat-warm"; }
        return { bags, offers, heat, heatClass };
    }

    function getSellerInfo(nextData) {
        const product = getListingFromNextData(nextData);
        // seller might be nested under seller, user, or seller.user
        const raw = product?.seller || product?.user || {};
        const seller = raw.user || raw;
        return {
            username: seller.username || "Unknown",
            rating: seller.rating || 0,
            reviews: seller.reviewsCount || seller.numberOfReviews || 0,
            initials: (seller.username || "U").substring(0, 1).toUpperCase()
        };
    }

    // --- Theme ---

    function detectTheme(card) {
        const bgColor = window.getComputedStyle(document.body).backgroundColor;
        const rgb = bgColor.match(/\d+/g);
        if (rgb) {
            const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
            card.setAttribute('data-theme', brightness < 128 ? 'dark' : 'light');
        }
    }

    function isProductPage() {
        return /\/products\/[^/]+/.test(window.location.pathname);
    }

    // --- Main Logic ---

    let isInitializing = false;
    let currentProductData = null;

    async function init(apiData = null) {
        if (!isProductPage()) {
            document.querySelector('.price-spy-card')?.remove();
            currentProductData = null;
            return;
        }
        if (isInitializing && !apiData) return;
        isInitializing = true;
        console.log("🕵️ Depop Price Spy: Initializing...", apiData ? "(API data)" : "(scraping)");

        try {
            const nextData = extractNextData();
            let product = apiData || getListingFromNextData(nextData);

            // If we still have no product, try scraping the page URL slug
            if (!product) {
                const slugMatch = window.location.pathname.match(/\/products\/([^/?#]+)/);
                if (slugMatch) product = { slug: slugMatch[1], title: document.querySelector('h1')?.textContent?.trim() || 'Unknown Item' };
            }

            // 1. Find placement anchor
            let buttonCluster = null;
            let attempts = 0;
            while (attempts < 12 && !buttonCluster) {
                const allButtons = Array.from(document.querySelectorAll('button'));
                const makeOfferBtn = allButtons.find(el => el.textContent.trim().toLowerCase().includes('make offer'));
                const addBagBtn = allButtons.find(el => el.textContent.trim().toLowerCase().includes('add to bag'));
                const buyBtn = allButtons.find(el => el.textContent.trim().toLowerCase().includes('buy now'));

                if (makeOfferBtn && addBagBtn) {
                    buttonCluster = findCommonAncestor(makeOfferBtn, addBagBtn);
                    if (buttonCluster?.parentElement?.childElementCount <= 4) buttonCluster = buttonCluster.parentElement;
                } else if (buyBtn) {
                    buttonCluster = buyBtn.closest('div') || buyBtn.parentElement;
                }

                if (!buttonCluster) {
                    await new Promise(r => setTimeout(r, 800));
                    attempts++;
                }
            }
            if (!buttonCluster) buttonCluster = document.querySelector('h1')?.parentElement;

            // 2. Extract title & price
            const title = product?.title
                || document.querySelector('h1')?.textContent?.trim()
                || "Unknown Item";

            let currentPrice = extractPriceValue(product);
            if (!currentPrice) {
                // DOM fallback: grab first element that looks like a price
                const priceEl = document.querySelector('[class*="price" i], [data-testid*="price" i], [class*="Price"]');
                currentPrice = parsePrice(priceEl?.textContent);
            }

            const currencySymbol = extractCurrencySymbol(product);
            const currentPriceStr = currencySymbol + (currentPrice || 0).toFixed(2);
            const url = window.location.href.split('?')[0];

            // Show loading card immediately
            injectCard({ loading: true, currentPriceStr, buttonCluster });

            // 3. Remaining data
            const daysListed = getDaysListed(nextData);
            const demand = getDemandSignals();
            const seller = getSellerInfo(nextData);

            if (apiData?.seller) {
                const s = apiData.seller.user || apiData.seller;
                seller.username = s.username || seller.username;
                seller.rating = s.rating || seller.rating;
                seller.reviews = s.reviewsCount || s.numberOfReviews || seller.reviews;
                seller.isVerified = s.verified || s.isVerified || false;
                seller.initials = (seller.username || "U")[0].toUpperCase();
            }

            // 4. Price history
            let priceHistory = [];
            try {
                const histKey = `history_${url}`;
                const stored = await chrome.storage.local.get(histKey);
                priceHistory = stored[histKey] || [];
                const last = priceHistory[priceHistory.length - 1];
                if (currentPrice > 0 && (!last || last.price !== currentPrice)) {
                    priceHistory.push({ price: currentPrice, timestamp: Date.now() });
                    if (priceHistory.length > 50) priceHistory.shift();
                    await chrome.storage.local.set({ [histKey]: priceHistory });
                }
            } catch (e) { console.warn('🕵️ storage error', e); }

            // 5. Market data via search pages
            let soldData = { avg: 0, min: 0, max: 0, count: 0 };
            let activeListings = [];

            try {
                // Fetch both in parallel for speed
                const q = encodeURIComponent(title);
                const [soldHtml, activeHtml] = await Promise.all([
                    fetchPageHtml(`https://www.depop.com/search/?q=${q}&sold=true`),
                    fetchPageHtml(`https://www.depop.com/search/?q=${q}`),
                ]);

                const soldResults = parseSearchHtml(soldHtml);
                const activeResults = parseSearchHtml(activeHtml);

                const soldPrices = soldResults.map(extractPriceValue).filter(p => p > 0);
                if (soldPrices.length > 0) {
                    soldData.count = soldPrices.length;
                    soldData.min = Math.min(...soldPrices);
                    soldData.max = Math.max(...soldPrices);
                    soldData.avg = soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length;
                }

                activeListings = activeResults.slice(0, 12).map(r => ({
                    title: r.title || "Unknown",
                    price: extractPriceValue(r),
                    img: r.images?.[0]?.[0]?.url || r.pictures?.[0]?.url || "",
                    url: "https://www.depop.com/products/" + (r.slug || ""),
                    daysAgo: r.dateListed ? calculateDaysFromDate(new Date(r.dateListed)) : "Unknown"
                }));

                console.log(`🕵️ sold: ${soldData.count}, active: ${activeListings.length}`);
            } catch (e) {
                console.warn('🕵️ market fetch error', e);
            }

            const diffPercent = soldData.avg > 0 ? Math.round(((currentPrice - soldData.avg) / soldData.avg) * 100) : 0;

            let rating = "Market Info Unavailable";
            let ratingClass = "rating-neutral";
            if (soldData.avg > 0) {
                if (currentPrice < soldData.avg * 0.85) { rating = "Great Deal"; ratingClass = "rating-great"; }
                else if (currentPrice > soldData.avg * 1.20) { rating = "Overpriced"; ratingClass = "rating-overpriced"; }
                else { rating = "Fair Price"; ratingClass = "rating-fair"; }
            }

            currentProductData = {
                loading: false, title, currentPrice, currentPriceStr,
                daysListed, demand, seller, priceHistory, soldData,
                activeListings, diffPercent, rating, ratingClass, buttonCluster
            };

            injectCard(currentProductData);
        } catch (err) {
            console.error('🕵️ init error', err);
        } finally {
            isInitializing = false;
        }
    }

    // Fetch a page and return its HTML text
    async function fetchPageHtml(url) {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`fetch ${url} => ${res.status}`);
        return res.text();
    }

    // Parse __NEXT_DATA__ from an HTML string
    function parseSearchHtml(html) {
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const script = doc.getElementById('__NEXT_DATA__');
            if (!script) return [];
            const data = JSON.parse(script.textContent);
            return extractSearchResults(data);
        } catch (e) {
            return [];
        }
    }

    function findCommonAncestor(el1, el2) {
        let p = el1.parentElement;
        while (p) {
            if (p.contains(el2)) return p;
            p = p.parentElement;
        }
        return el1.parentElement;
    }

    // --- Card Rendering ---

    function injectCard(data) {
        let card = document.querySelector('.price-spy-card');
        if (!card) {
            card = document.createElement('div');
            card.className = 'price-spy-card';
            if (data.buttonCluster) {
                data.buttonCluster.insertAdjacentElement('afterend', card);
            } else {
                document.body.appendChild(card);
                Object.assign(card.style, { position:'fixed', bottom:'20px', right:'20px', zIndex:'9999', maxWidth:'350px', boxShadow:'0 10px 25px rgba(0,0,0,0.2)' });
            }
            detectTheme(card);
        }

        if (data.loading) {
            card.innerHTML = `
                <div class="price-spy-main-content">
                    <div class="price-spy-header">
                        <span class="spy-emoji">🕵️</span>
                        <span class="spy-title">DEPOP PRICE SPY</span>
                    </div>
                    <div class="loading-container">
                        <div class="loading-pulse">Analyzing listing data...</div>
                        <div class="loading-bar-bg"><div class="loading-bar-fill"></div></div>
                    </div>
                </div>`;
            return;
        }

        const hasSoldData = data.soldData.avg > 0;
        const statBoxStyle = hasSoldData ? '' : 'background-color: rgba(107, 114, 128, 0.08);';
        const ratingBadgeHTML = hasSoldData
            ? `<div class="spy-badge ${data.ratingClass}"><span class="badge-dot"></span>${data.rating}</div>`
            : '';

        card.innerHTML = `
            <div class="price-spy-main-content">
                <div class="price-spy-header">
                    <span class="spy-emoji">🕵️</span>
                    <span class="spy-title">DEPOP PRICE SPY</span>
                </div>
                <div class="spy-stats-grid">
                    <div class="spy-stat-box" style="${statBoxStyle}">
                        <div class="spy-stat-label">AVG SOLD</div>
                        <div class="spy-stat-value">${hasSoldData ? formatCurrency(data.soldData.avg, data.currentPriceStr) : '—'}</div>
                    </div>
                    <div class="spy-stat-box" style="${statBoxStyle}">
                        <div class="spy-stat-label">MARKET RANGE</div>
                        <div class="spy-stat-value">${hasSoldData ? `${formatCurrency(data.soldData.min, data.currentPriceStr)}–${formatCurrency(data.soldData.max, data.currentPriceStr)}` : '—'}</div>
                    </div>
                </div>
                <div class="spy-badges-row">
                    ${ratingBadgeHTML}
                    <div class="spy-badge ${data.demand.heatClass}">
                        <span class="badge-dot"></span>${data.demand.heat} Demand
                    </div>
                </div>
                <button class="spy-expand-btn expand-trigger">
                    <span>SEE FULL ANALYSIS</span>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                </button>
            </div>`;

        card.querySelector('.expand-trigger').addEventListener('click', () => openModal());
    }

    // --- Modal (unchanged from original, just pasted for completeness) ---

    function openModal() {
        if (!currentProductData) return;
        const data = currentProductData;
        document.querySelector('.spy-overlay-backdrop')?.remove();
        document.querySelector('.spy-modal-positioner')?.remove();

        const backdrop = document.createElement('div');
        backdrop.className = 'spy-overlay-backdrop';
        document.body.appendChild(backdrop);

        const positioner = document.createElement('div');
        positioner.className = 'spy-modal-positioner';
        const inner = document.createElement('div');
        inner.className = 'spy-modal-inner';
        const theme = document.querySelector('.price-spy-card')?.getAttribute('data-theme') || 'light';
        inner.setAttribute('data-theme', theme);

        inner.innerHTML = `
            <button class="spy-modal-close">×</button>
            <div class="price-spy-tabs">
                <div class="price-spy-tab is-active" data-tab="history">HISTORY</div>
                <div class="price-spy-tab" data-tab="similar">SIMILAR</div>
                <div class="price-spy-tab" data-tab="market">MARKET</div>
                <div class="price-spy-tab" data-tab="seller">SELLER</div>
            </div>
            <div class="price-spy-tab-content is-active" id="tab-history">
                <div class="price-history-container">
                    ${data.priceHistory.length > 1 ? `
                        <canvas class="price-history-canvas"></canvas>
                        <div class="price-history-summary">
                            <div class="summary-item">
                                <span class="summary-label">FIRST SEEN</span>
                                <span class="summary-value">${new Date(data.priceHistory[0].timestamp).toLocaleDateString()}</span>
                            </div>
                            ${data.priceHistory[0].price > data.currentPrice ? `
                                <div class="summary-item">
                                    <span class="summary-label">PRICE DROP</span>
                                    <span class="summary-value" style="color:var(--spy-success)">${formatCurrency(data.priceHistory[0].price - data.currentPrice, data.currentPriceStr)} SAVED</span>
                                </div>` : `
                                <div class="summary-item">
                                    <span class="summary-label">STATUS</span>
                                    <span class="summary-value">STABLE</span>
                                </div>`}
                        </div>` : `
                        <div class="empty-state">
                            <div class="empty-icon">📈</div>
                            <div class="empty-text">Tracking started. Visit again later to see price changes.</div>
                        </div>`}
                </div>
            </div>
            <div class="price-spy-tab-content" id="tab-similar">
                <div class="similar-sort-bar">
                    SORT: <span class="sort-btn" data-sort="low">LOWEST</span> • <span class="sort-btn" data-sort="high">HIGHEST</span> • <span class="sort-btn" data-sort="new">NEWEST</span>
                </div>
                <div class="similar-listings-list">${renderSimilarListings(data.activeListings, data.currentPriceStr, data.soldData.avg)}</div>
            </div>
            <div class="price-spy-tab-content" id="tab-market">
                <div class="market-chart">${renderMarketChart(data)}</div>
                <div class="market-stats-text">
                    <div class="market-stat-card">
                        <div class="market-stat-label">MARKET SUPPLY</div>
                        <div class="market-stat-value">${data.activeListings.length > 15 ? "HIGH" : "LOW"}</div>
                        <div class="market-stat-desc">${data.activeListings.length > 15 ? "Buyer's Market" : "Seller's Market"}</div>
                    </div>
                    <div class="market-stat-card">
                        <div class="market-stat-label">SELL-THROUGH</div>
                        <div class="market-stat-value">${data.soldData.count > 5 ? "HIGH" : "MODERATE"}</div>
                        <div class="market-stat-desc">${data.soldData.count > 5 ? "High Demand" : "Steady Interest"}</div>
                    </div>
                </div>
            </div>
            <div class="price-spy-tab-content" id="tab-seller">${renderSellerTab(data)}</div>`;

        positioner.appendChild(inner);
        document.body.appendChild(positioner);
        setTimeout(() => { backdrop.classList.add('is-visible'); inner.classList.add('is-visible'); }, 10);

        const close = () => {
            backdrop.classList.remove('is-visible');
            inner.classList.remove('is-visible');
            setTimeout(() => { backdrop.remove(); positioner.remove(); }, 300);
        };
        inner.querySelector('.spy-modal-close').onclick = close;
        backdrop.onclick = close;

        const tabs = inner.querySelectorAll('.price-spy-tab');
        const contents = inner.querySelectorAll('.price-spy-tab-content');
        tabs.forEach(tab => {
            tab.onclick = () => {
                const target = tab.getAttribute('data-tab');
                tabs.forEach(t => t.classList.remove('is-active'));
                contents.forEach(c => c.classList.remove('is-active'));
                tab.classList.add('is-active');
                inner.querySelector(`#tab-${target}`).classList.add('is-active');
                if (target === 'history' && data.priceHistory.length > 1) {
                    setTimeout(() => drawPriceHistory(inner.querySelector('.price-history-canvas'), data.priceHistory, data.soldData.avg), 50);
                }
            };
        });

        if (data.priceHistory.length > 1) {
            setTimeout(() => drawPriceHistory(inner.querySelector('.price-history-canvas'), data.priceHistory, data.soldData.avg), 100);
        }

        setupSellerInteractions(inner, data);
    }

    function renderSimilarListings(listings, priceStr, avgSold) {
        if (!listings.length) return '<div class="empty-state">No similar listings found.</div>';
        return listings.map(item => {
            let badge = "Fair", badgeClass = "rating-fair";
            if (avgSold > 0) {
                if (item.price < avgSold * 0.85) { badge = "Good Deal"; badgeClass = "rating-great"; }
                else if (item.price > avgSold * 1.15) { badge = "Overpriced"; badgeClass = "rating-overpriced"; }
            }
            return `<a href="${item.url}" target="_blank" class="similar-item">
                <div class="similar-thumb-placeholder" style="background:${getColorFromTitle(item.title)}">${item.title[0]?.toUpperCase()}</div>
                <div class="similar-info">
                    <div class="similar-title">${item.title}</div>
                    <div class="similar-price">${formatCurrency(item.price, priceStr)}</div>
                    <div class="similar-listed-date">Listed ${item.daysAgo} days ago</div>
                    <span class="similar-badge ${badgeClass}">${badge}</span>
                </div>
            </a>`;
        }).join('');
    }

    function renderMarketChart(data) {
        const prices = [
            { label: "THIS ITEM", val: data.currentPrice, color: "var(--spy-accent)" },
            { label: "AVG SOLD", val: data.soldData.avg, color: "var(--spy-muted)" },
            { label: "LOWEST ACTIVE", val: data.activeListings.length > 0 ? Math.min(...data.activeListings.map(l => l.price)) : 0, color: "var(--spy-warning)" }
        ].filter(p => p.val > 0);
        const maxVal = Math.max(...prices.map(p => p.val)) || 1;
        return prices.map(p => `
            <div class="market-bar-row">
                <div class="market-bar-label">
                    <span>${p.label}</span>
                    <span style="font-family:var(--spy-font-mono)">${formatCurrency(p.val, data.currentPriceStr)}</span>
                </div>
                <div class="market-bar-wrapper"><div class="market-bar" style="width:${(p.val/maxVal)*100}%;background-color:${p.color}"></div></div>
            </div>`).join('') + `
            <div class="market-data-source">Based on <strong>${data.soldData.count}</strong> sold and <strong>${data.activeListings.length}</strong> active listings</div>
            <div class="market-data-source"><strong>Market:</strong> ${data.activeListings.length > 10 ? "Buyer's Market" : "Seller's Market"}</div>
            <div class="market-data-source"><strong>Sell-through:</strong> ${data.soldData.count > 8 ? 'High' : data.soldData.count > 3 ? 'Moderate' : 'Low'}</div>`;
    }

    function renderSellerTab(data) {
        const scoreData = calculateSellerScore(data);
        return `
            <div class="seller-stats-header">
                <div class="seller-avatar-placeholder">${data.seller.initials}</div>
                <div class="seller-meta">
                    <div class="seller-username-row">@${data.seller.username}</div>
                    <div class="seller-rating-row">
                        <span class="star-rating">${"★".repeat(Math.round(data.seller.rating))}${"☆".repeat(5-Math.round(data.seller.rating))}</span>
                        <span>(${data.seller.reviews} REVIEWS)</span>
                    </div>
                </div>
            </div>
            <div class="intelligence-score-section">
                <div class="score-header">
                    <div class="score-title">OFFER INTELLIGENCE <span class="info-tooltip-trigger">ⓘ<div class="info-tooltip">Predicts seller motivation based on listing age, price drops, and market demand.</div></span></div>
                    <div class="score-verdict" style="color:${scoreData.color}">${scoreData.verdict}</div>
                </div>
                <div class="score-progress-bar"><div class="score-fill" style="width:${scoreData.normalized*10}%;background-color:${scoreData.color}"></div></div>
                <ul class="score-bullets">${scoreData.bullets.map(b=>`<li><span>${b.icon}</span> ${b.text}</li>`).join('')}</ul>
            </div>
            <div class="offer-calculator-section">
                <div class="calculator-title">INTERACTIVE OFFER CALCULATOR</div>
                <div class="calculator-input-row">
                    <input type="number" class="offer-input" placeholder="ENTER OFFER AMOUNT" />
                    <button class="analyze-btn">ANALYZE</button>
                </div>
                <div class="calculator-results" style="display:none">
                    <div class="results-verdict"></div>
                    <div class="results-explanation"></div>
                    <div class="sweet-spot-box"></div>
                </div>
            </div>`;
    }

    function calculateSellerScore(data) {
        let raw = 0;
        const bullets = [];
        if (data.daysListed > 30) { raw += 3; bullets.push({ icon:"⏳", text:"Listed 30+ days (High motivation)" }); }
        else if (data.daysListed > 14) { raw += 1; bullets.push({ icon:"📅", text:"Listed 2 weeks" }); }
        else { raw -= 1; bullets.push({ icon:"✨", text:"Fresh listing (Lower motivation)" }); }
        if (data.priceHistory.length > 1 && data.priceHistory[0].price > data.currentPrice) {
            raw += 3; bullets.push({ icon:"📉", text:"Seller already dropped price" });
        }
        if (data.soldData.avg > 0) {
            if (data.currentPrice > data.soldData.avg * 1.1) { raw += 2; bullets.push({ icon:"💰", text:"Priced above market average" }); }
            else if (data.currentPrice < data.soldData.avg * 0.9) { raw -= 2; bullets.push({ icon:"🏷️", text:"Already priced competitively" }); }
        }
        if (data.demand.bags > 15) { raw -= 2; bullets.push({ icon:"🔥", text:"High bag interest" }); }
        if (data.seller.reviews < 25) { raw += 1; bullets.push({ icon:"🆕", text:"Newer seller (More flexible)" }); }
        else if (data.seller.reviews > 100) { raw -= 1; bullets.push({ icon:"✅", text:"Experienced seller" }); }
        const normalized = Math.max(0, Math.min(10, ((raw + 5) / 15) * 10));
        let verdict = "Uncertain ⚪", color = "#94a3b8";
        if (raw >= 6) { verdict = "Very Likely ✅"; color = "#22c55e"; }
        else if (raw >= 3) { verdict = "Likely 🟡"; color = "#eab308"; }
        else if (raw <= 0) { verdict = "Unlikely 🔴"; color = "#ef4444"; }
        return { raw, normalized, verdict, color, bullets };
    }

    function setupSellerInteractions(modal, data) {
        const input = modal.querySelector('.offer-input');
        const btn = modal.querySelector('.analyze-btn');
        const results = modal.querySelector('.calculator-results');
        const verdictEl = modal.querySelector('.results-verdict');
        const explanationEl = modal.querySelector('.results-explanation');
        const sweetSpotEl = modal.querySelector('.sweet-spot-box');
        if (!btn) return;

        btn.onclick = () => {
            const offer = parseFloat(input.value);
            if (!offer || offer <= 0) return;
            results.style.display = 'block';
            verdictEl.innerText = 'Analyzing...';
            verdictEl.style.color = '#94a3b8';
            explanationEl.innerText = '';
            sweetSpotEl.style.display = 'none';

            setTimeout(() => {
                const baseScore = calculateSellerScore(data).raw;
                let offerScore = 0;
                const pctBelow = ((data.currentPrice - offer) / data.currentPrice) * 100;
                if (pctBelow <= 10) offerScore += 3;
                else if (pctBelow <= 20) offerScore += 1;
                else if (pctBelow <= 30) offerScore -= 1;
                else offerScore -= 3;
                if (data.soldData.avg > 0) {
                    if (offer > data.soldData.avg) offerScore += 2;
                    else if (data.soldData.avg - offer <= 5) offerScore += 1;
                    else if (data.soldData.avg - offer <= 15) offerScore -= 1;
                    else offerScore -= 3;
                }
                const combined = baseScore + offerScore;
                let v = "Very likely declined ❌", vc = "#ef4444";
                if (combined >= 8) { v = "Strong chance of acceptance ✅"; vc = "#22c55e"; }
                else if (combined >= 4) { v = "Decent shot 🟡"; vc = "#eab308"; }
                else if (combined >= 1) { v = "Slim chance ⚠️"; vc = "#f97316"; }
                const sweetSpotPrice = data.soldData.avg > 0
                    ? (baseScore >= 5 ? Math.max(offer, data.soldData.avg * 0.90) : baseScore >= 2 ? data.soldData.avg * 0.95 : data.currentPrice * 0.92)
                    : data.currentPrice * 0.85;
                verdictEl.innerText = v;
                verdictEl.style.color = vc;
                explanationEl.innerText = `Your offer of ${formatCurrency(offer, data.currentPriceStr)} is ${Math.round(pctBelow)}% below asking.`;
                sweetSpotEl.style.display = 'block';
                sweetSpotEl.innerText = `💡 Sweet spot: ~${formatCurrency(sweetSpotPrice, data.currentPriceStr)}`;
            }, 800);
        };
    }

    function drawPriceHistory(canvas, history, avgSold) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        const w = rect.width, h = rect.height, pad = 35;
        const gw = w - pad * 2, gh = h - pad * 2;
        const prices = history.map(h => h.price);
        if (avgSold > 0) prices.push(avgSold);
        const minP = Math.min(...prices) * 0.95, maxP = Math.max(...prices) * 1.05;
        const rangeP = maxP - minP || 1;
        const getX = i => pad + (i / (history.length - 1)) * gw;
        const getY = p => pad + gh - ((p - minP) / rangeP) * gh;
        const card = document.querySelector('.price-spy-card');
        const isDark = card?.getAttribute('data-theme') === 'dark';
        const accent = '#ff4e00', textColor = isDark ? '#9ca3af' : '#6b7280';
        const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
        const dotBorder = isDark ? '#1a1a1a' : '#ffffff';
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, pad + gh); ctx.lineTo(pad + gw, pad + gh); ctx.stroke();
        ctx.fillStyle = textColor; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        history.forEach((e, i) => {
            if (history.length > 6 && i % Math.ceil(history.length / 5) !== 0) return;
            ctx.fillText(new Date(e.timestamp).toLocaleDateString(undefined, { month:'short', day:'numeric' }), getX(i), pad + gh + 15);
        });
        ctx.textAlign = 'right';
        ctx.fillText(formatCurrency(maxP, '$'), pad - 5, pad + 5);
        ctx.fillText(formatCurrency(minP, '$'), pad - 5, pad + gh);
        if (avgSold > 0) {
            ctx.setLineDash([4, 4]); ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1;
            const avgY = getY(avgSold);
            ctx.beginPath(); ctx.moveTo(pad, avgY); ctx.lineTo(pad + gw, avgY); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = '#22c55e'; ctx.font = '10px sans-serif';
            ctx.textAlign = 'left'; ctx.fillText('Avg Sold', pad + gw - 55, avgY - 5);
        }
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath();
        history.forEach((e, i) => { const x = getX(i), y = getY(e.price); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke();
        history.forEach((e, i) => {
            const x = getX(i), y = getY(e.price);
            ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = dotBorder; ctx.lineWidth = 1.5; ctx.stroke();
        });
    }

    // --- SPA Navigation ---

    let lastUrl = location.href;
    let lastProductId = '';
    function getProductId() {
        const m = location.href.match(/\/products\/([^/?#]+)/);
        return m ? m[1] : '';
    }
    const observer = new MutationObserver(() => {
        const cur = location.href, pid = getProductId();
        if (cur !== lastUrl || pid !== lastProductId) {
            lastUrl = cur; lastProductId = pid;
            if (cur.includes('/products/')) {
                document.querySelector('.price-spy-card')?.remove();
                setTimeout(init, 1500);
            }
        }
    });
    observer.observe(document, { subtree: true, childList: true });
    window.addEventListener('popstate', () => setTimeout(init, 1000));

    window.addEventListener('message', event => {
        if (event.data?.type === 'DEPOP_API_RESPONSE' && location.pathname.includes('/products/')) {
            const d = event.data.data;
            // Handle multiple known API response shapes
            const product = d?.product || d?.listing || d?.data?.product || d;
            if (product?.id || product?.slug) {
                console.log('🕵️ API data received, re-initializing');
                init(product);
            }
        }
    });

    if (isProductPage()) {
        const check = setInterval(() => {
            if (document.querySelector('h1')) { clearInterval(check); init(); }
        }, 500);
        setTimeout(() => clearInterval(check), 8000);
    }

})();
