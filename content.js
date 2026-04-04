/**
 * Depop Price Spy - Expanded Content Script
 */

(function() {
    'use strict';

    // --- Utility Functions ---

    function parsePrice(priceStr) {
        if (!priceStr) return 0;
        const numeric = priceStr.replace(/[^0-9.]/g, '');
        return parseFloat(numeric) || 0;
    }

    function formatCurrency(value, originalStr) {
        const symbol = originalStr.match(/[^\d.,\s]/)?.[0] || '$';
        return symbol + value.toFixed(2);
    }

    function calculateDaysFromDate(date) {
        const diffTime = Math.abs(new Date() - date);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // --- Data Extraction ---

    function extractNextData() {
        try {
            const script = document.getElementById('__NEXT_DATA__');
            if (script) {
                const data = JSON.parse(script.textContent);

                // Log the structure for debugging (truncated to 2 levels)
                const truncated = JSON.stringify(data, (key, value) => {
                    if (typeof value === 'object' && value !== null) {
                        const depth = key.split('.').length;
                        if (depth > 2) return '[Object]';
                    }
                    return value;
                }, 2);
                console.log('🕵️ Price Spy: __NEXT_DATA__ structure:', truncated.substring(0, 1000) + '...');

                return data;
            }
        } catch (e) {
            console.error("🕵️ Price Spy: Error parsing __NEXT_DATA__", e);
        }
        return null;
    }

    function getListingFromNextData(nextData) {
        if (!nextData) return null;

        // Deep search function that recursively walks the entire JSON tree
        function deepSearchForListing(obj, visited = new Set()) {
            // Prevent infinite loops from circular references
            if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
            visited.add(obj);

            // Check if this object looks like a product/listing
            // Must have: price field AND title field AND (id OR slug)
            const hasPrice = obj.price !== undefined || obj.priceAmount !== undefined;
            const hasTitle = obj.title !== undefined && typeof obj.title === 'string';
            const hasId = obj.id !== undefined || obj.slug !== undefined;

            if (hasPrice && hasTitle && hasId) {
                console.log('🕵️ Price Spy: Found product node via deep search');
                return obj;
            }

            // Recursively search all properties
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const result = deepSearchForListing(obj[key], visited);
                    if (result) return result;
                }
            }

            // Also check array elements
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    const result = deepSearchForListing(item, visited);
                    if (result) return result;
                }
            }

            return null;
        }

        return deepSearchForListing(nextData);
    }

    // --- Data Scraping ---

    function getDaysListed(nextData) {
        const product = getListingFromNextData(nextData);
        if (product && product.dateListed) {
            return calculateDaysFromDate(new Date(product.dateListed));
        }
        const timeEl = document.querySelector('time');
        if (timeEl && timeEl.getAttribute('datetime')) {
            const date = new Date(timeEl.getAttribute('datetime'));
            return calculateDaysFromDate(date);
        }
        return "Unknown";
    }

    function getDemandSignals() {
        const text = document.body.innerText;
        const bagsMatch = text.match(/In (\d+) people's bags/i);
        const offersMatch = text.match(/(\d+) offers sent/i);
        const bags = bagsMatch ? parseInt(bagsMatch[1]) : 0;
        const offers = offersMatch ? parseInt(offersMatch[1]) : 0;
        
        let heat = "Low";
        let heatClass = "heat-low";
        if (bags > 10 || offers > 5) {
            heat = "Hot";
            heatClass = "heat-hot";
        } else if (bags > 3 || offers > 2) {
            heat = "Warm";
            heatClass = "heat-warm";
        }
        return { bags, offers, heat, heatClass };
    }

    function getSellerInfo(nextData) {
        const product = getListingFromNextData(nextData);
        const seller = product?.seller || {};
        return {
            username: seller.username || "Unknown",
            rating: seller.rating || 0,
            reviews: seller.reviewsCount || 0,
            isVerified: seller.isVerified || false,
            shopItems: seller.productsCount || 0,
            initials: (seller.username || "U").substring(0, 1).toUpperCase()
        };
    }

    function extractSearchResults(searchData) {
        if (!searchData) return [];

        // Try all known result paths
        const paths = [
            searchData.props?.pageProps?.initialState?.products?.results,
            searchData.props?.pageProps?.products,
            searchData.props?.pageProps?.initialData?.products,
            searchData.props?.pageProps?.searchResults
        ];

        for (const path of paths) {
            if (Array.isArray(path) && path.length > 0) {
                console.log('🕵️ Price Spy: Found results via path search');
                return path;
            }
        }

        // Fallback: recursively search for any array with items that have a price field
        function findResultsArray(obj, visited = new Set()) {
            if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
            visited.add(obj);

            // Check if this is an array with items that have prices
            if (Array.isArray(obj) && obj.length > 2) {
                const hasItemsWithPrice = obj.slice(0, 3).some(item =>
                    item && typeof item === 'object' &&
                    (item.price !== undefined || item.priceAmount !== undefined)
                );
                if (hasItemsWithPrice) {
                    console.log('🕵️ Price Spy: Found results via recursive array search');
                    return obj;
                }
            }

            // Recursively search properties
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const result = findResultsArray(obj[key], visited);
                    if (result) return result;
                }
            }

            return null;
        }

        const fallbackResults = findResultsArray(searchData);
        return fallbackResults || [];
    }

    // --- Theme Management ---

    function detectTheme(card) {
        const bgColor = window.getComputedStyle(document.body).backgroundColor;
        const rgb = bgColor.match(/\d+/g);
        if (rgb) {
            const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
            const isDark = brightness < 128;
            card.setAttribute('data-theme', isDark ? 'dark' : 'light');
            const modal = document.querySelector('.spy-modal-inner');
            if (modal) modal.setAttribute('data-theme', isDark ? 'dark' : 'light');
        }
    }

    function isProductPage() {
        return window.location.pathname.includes('/products/');
    }

    // --- Main Logic ---

    let isInitializing = false;
    let currentProductData = null;
    async function init(apiData = null) {
        if (!isProductPage()) {
            const existingCard = document.querySelector('.price-spy-card');
            if (existingCard) existingCard.remove();
            currentProductData = null;
            return;
        }
        if (isInitializing && !apiData) return;
        isInitializing = true;
        console.log("🕵️ Depop Price Spy: Initializing...", apiData ? "(with API data)" : "(scraping)");
        
        try {
            const nextData = extractNextData();
            const product = apiData || getListingFromNextData(nextData);

            // 1. Find placement
            let buttonCluster;
            let attempts = 0;
            const maxAttempts = apiData ? 1 : 10;
            
            while (attempts < maxAttempts && !buttonCluster) {
                const allElements = Array.from(document.querySelectorAll('button'));
                const makeOfferBtn = allElements.find(el => el.textContent.toLowerCase().includes('make offer'));
                const addBagBtn = allElements.find(el => el.textContent.toLowerCase().includes('add to bag'));

                if (makeOfferBtn && addBagBtn) {
                    const actionRow = findCommonAncestor(makeOfferBtn, addBagBtn);
                    buttonCluster = actionRow;
                    if (buttonCluster.parentElement && buttonCluster.parentElement.childElementCount <= 3) {
                        buttonCluster = buttonCluster.parentElement;
                    }
                } else {
                    const buyBtn = allElements.find(el => el.textContent.toLowerCase().includes('buy now'));
                    if (buyBtn) {
                        buttonCluster = buyBtn.closest('div[class*="ButtonContainer"]') || buyBtn.parentElement;
                    }
                }
                
                if (buttonCluster) {
                    const next = buttonCluster.nextElementSibling;
                    if (next && (next.tagName === 'HR' || (next.offsetHeight > 0 && next.offsetHeight <= 2))) {
                        buttonCluster = next;
                    }
                }

                if (!buttonCluster && !apiData) {
                    await new Promise(r => setTimeout(r, 1000));
                    attempts++;
                } else if (!buttonCluster) {
                    break;
                }
            }

            if (!buttonCluster) {
                buttonCluster = document.querySelector('h1')?.parentElement;
            }

            // 2. Extract basic data
            const title = product?.title || document.querySelector('h1')?.textContent?.trim() || "Unknown Item";
            let currentPrice = 0;
            if (product?.price?.priceAmount) {
                currentPrice = parseFloat(product.price.priceAmount);
            } else if (product?.priceAmount) {
                currentPrice = parseFloat(product.priceAmount);
            } else {
                currentPrice = parsePrice(document.querySelector('[class*="Price"]')?.textContent);
            }

            const currencySymbol = product?.price?.currencySymbol || product?.currencySymbol || "$";
            const currentPriceStr = currencySymbol + currentPrice.toFixed(2);
            const url = window.location.href.split('?')[0];

            injectCard({ loading: true, currentPriceStr, buttonCluster });

            // 3. Scrape/Extract more data
            const daysListed = getDaysListed(nextData);
            const demand = getDemandSignals();
            const seller = getSellerInfo(nextData);
            
            if (apiData && apiData.seller) {
                seller.username = apiData.seller.username || seller.username;
                seller.rating = apiData.seller.rating || seller.rating;
                seller.reviews = apiData.seller.reviewsCount || seller.reviews;
                seller.isVerified = apiData.seller.isVerified || seller.isVerified;
                seller.initials = (seller.username || "U").substring(0, 1).toUpperCase();
            }

            // 4. Price History
            let priceHistory = [];
            try {
                const historyKey = `history_${url}`;
                const data = await chrome.storage.local.get(historyKey);
                priceHistory = data[historyKey] || [];
                const now = Date.now();
                const lastEntry = priceHistory[priceHistory.length - 1];
                if (!lastEntry || lastEntry.price !== currentPrice) {
                    priceHistory.push({ price: currentPrice, timestamp: now });
                    if (priceHistory.length > 50) priceHistory.shift();
                    await chrome.storage.local.set({ [historyKey]: priceHistory });
                }
            } catch (e) {}

            // 5. Market Data
            let soldData = { avg: 0, min: 0, max: 0, count: 0 };
            try {
                const titleEncoded = encodeURIComponent(title);
                const soldUrls = [
                    `https://www.depop.com/search/?q=${titleEncoded}&sold=true`,
                    `https://www.depop.com/search/?q=${titleEncoded}&itemsType=sold`
                ];

                let searchData = null;
                let html = null;

                // Try both URL formats
                for (const soldUrl of soldUrls) {
                    try {
                        const response = await fetch(soldUrl);
                        html = await response.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        const script = doc.getElementById('__NEXT_DATA__');
                        if (script) {
                            searchData = JSON.parse(script.textContent);
                            break;
                        }
                    } catch (e) {}
                }

                let prices = [];
                if (searchData) {
                    const results = extractSearchResults(searchData);
                    prices = results.map(r => parseFloat(r.price?.priceAmount)).filter(p => p > 0);
                }

                if (prices.length === 0 && html) {
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    prices = Array.from(doc.querySelectorAll('[data-testid="product__card"]'))
                        .map(card => parsePrice(card.querySelector('[class*="Price"]')?.textContent))
                        .filter(p => p > 0);
                }

                if (prices.length > 0) {
                    soldData.count = prices.length;
                    soldData.min = Math.min(...prices);
                    soldData.max = Math.max(...prices);
                    soldData.avg = prices.reduce((a, b) => a + b, 0) / prices.length;
                }
            } catch (e) {}

            // 6. Similar Active
            let activeListings = [];
            try {
                const activeUrl = `https://www.depop.com/search/?q=${encodeURIComponent(title)}`;
                const response = await fetch(activeUrl);
                const html = await response.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const script = doc.getElementById('__NEXT_DATA__');
                if (script) {
                    const searchData = JSON.parse(script.textContent);
                    const results = extractSearchResults(searchData);
                    activeListings = results.slice(0, 12).map(r => ({
                        title: r.title || "Unknown",
                        price: parseFloat(r.price?.priceAmount) || 0,
                        img: r.images?.[0]?.[0]?.url || "",
                        url: "https://www.depop.com/products/" + r.slug,
                        dateListed: r.dateListed,
                        daysAgo: r.dateListed ? calculateDaysFromDate(new Date(r.dateListed)) : "Unknown"
                    }));
                }
            } catch (e) {}

            const diffPercent = soldData.avg > 0 ? Math.round(((currentPrice - soldData.avg) / soldData.avg) * 100) : 0;
            let rating = "Fair Price";
            let ratingClass = "rating-fair";
            if (soldData.avg > 0) {
                if (currentPrice < soldData.avg * 0.85) { rating = "Great Deal"; ratingClass = "rating-great"; }
                else if (currentPrice > soldData.avg * 1.20) { rating = "Overpriced"; ratingClass = "rating-overpriced"; }
            }

            currentProductData = {
                loading: false,
                title,
                currentPrice,
                currentPriceStr,
                daysListed,
                demand,
                seller,
                priceHistory,
                soldData,
                activeListings,
                diffPercent,
                rating,
                ratingClass,
                buttonCluster
            };

            injectCard(currentProductData);
        } finally {
            isInitializing = false;
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

    function injectCard(data) {
        let card = document.querySelector('.price-spy-card');
        if (!card) {
            card = document.createElement('div');
            card.className = 'price-spy-card';
            if (data.buttonCluster) {
                data.buttonCluster.insertAdjacentElement('afterend', card);
            } else {
                document.body.appendChild(card);
                card.style.position = 'fixed';
                card.style.bottom = '20px';
                card.style.right = '20px';
                card.style.zIndex = '9999';
                card.style.maxWidth = '350px';
                card.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
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
                </div>
            `;
            return;
        }

        card.innerHTML = `
            <div class="price-spy-main-content">
                <div class="price-spy-header">
                    <span class="spy-emoji">🕵️</span>
                    <span class="spy-title">DEPOP PRICE SPY</span>
                </div>
                
                <div class="spy-stats-grid">
                    <div class="spy-stat-box">
                        <div class="spy-stat-label">AVG SOLD</div>
                        <div class="spy-stat-value">${data.soldData.avg > 0 ? formatCurrency(data.soldData.avg, data.currentPriceStr) : 'N/A'}</div>
                    </div>
                    <div class="spy-stat-box">
                        <div class="spy-stat-label">MARKET RANGE</div>
                        <div class="spy-stat-value">${data.soldData.count > 0 ? `${formatCurrency(data.soldData.min, data.currentPriceStr)}–${formatCurrency(data.soldData.max, data.currentPriceStr)}` : 'N/A'}</div>
                    </div>
                </div>

                <div class="spy-badges-row">
                    <div class="spy-badge ${data.ratingClass}">
                        <span class="badge-dot"></span>
                        ${data.rating}
                    </div>
                    <div class="spy-badge ${data.demand.heatClass}">
                        <span class="badge-dot"></span>
                        ${data.demand.heat} Demand
                    </div>
                </div>

                <button class="spy-expand-btn expand-trigger">
                    <span>SEE FULL ANALYSIS</span>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                </button>
            </div>
        `;

        const expandTrigger = card.querySelector('.expand-trigger');
        expandTrigger.addEventListener('click', () => openModal());
    }

    function openModal() {
        if (!currentProductData) return;
        const data = currentProductData;
        const existing = document.querySelector('.spy-overlay-backdrop');
        if (existing) existing.remove();
        const existingPos = document.querySelector('.spy-modal-positioner');
        if (existingPos) existingPos.remove();

        const backdrop = document.createElement('div');
        backdrop.className = 'spy-overlay-backdrop';
        document.body.appendChild(backdrop);

        const positioner = document.createElement('div');
        positioner.className = 'spy-modal-positioner';
        
        const inner = document.createElement('div');
        inner.className = 'spy-modal-inner';
        
        const card = document.querySelector('.price-spy-card');
        const theme = card.getAttribute('data-theme');
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
                                    <span class="summary-value" style="color: var(--spy-success)">${formatCurrency(data.priceHistory[0].price - data.currentPrice, data.currentPriceStr)} SAVED</span>
                                </div>
                            ` : `
                                <div class="summary-item">
                                    <span class="summary-label">STATUS</span>
                                    <span class="summary-value">STABLE</span>
                                </div>
                            `}
                        </div>
                    ` : `
                        <div class="empty-state">
                            <div class="empty-icon">📈</div>
                            <div class="empty-text">Tracking started. Visit this listing again later to see price changes over time.</div>
                        </div>
                    `}
                </div>
            </div>

            <div class="price-spy-tab-content" id="tab-similar">
                <div class="similar-sort-bar">
                    SORT: <span class="sort-btn" data-sort="low">LOWEST</span> • <span class="sort-btn" data-sort="high">HIGHEST</span> • <span class="sort-btn" data-sort="new">NEWEST</span>
                </div>
                <div class="similar-listings-list">
                    ${renderSimilarListings(data.activeListings, data.currentPriceStr, data.soldData.avg)}
                </div>
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

            <div class="price-spy-tab-content" id="tab-seller">
                ${renderSellerTab(data)}
            </div>
        `;

        positioner.appendChild(inner);
        document.body.appendChild(positioner);

        setTimeout(() => {
            backdrop.classList.add('is-visible');
            inner.classList.add('is-visible');
        }, 10);

        const close = () => {
            backdrop.classList.remove('is-visible');
            inner.classList.remove('is-visible');
            setTimeout(() => {
                backdrop.remove();
                positioner.remove();
            }, 300);
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
        if (listings.length === 0) return '<div class="empty-state">No similar listings found.</div>';
        return listings.map(item => {
            let badge = "Fair";
            let badgeClass = "rating-fair";
            if (avgSold > 0) {
                if (item.price < avgSold * 0.85) { badge = "Good Deal"; badgeClass = "rating-great"; }
                else if (item.price > avgSold * 1.15) { badge = "Overpriced"; badgeClass = "rating-overpriced"; }
            }
            return `
                <a href="${item.url}" target="_blank" class="similar-item">
                    <img src="${item.img}" class="similar-thumb" />
                    <div class="similar-info">
                        <div class="similar-title">${item.title}</div>
                        <div class="similar-price">${formatCurrency(item.price, priceStr)}</div>
                        <div class="similar-listed-date">Listed ${item.daysAgo} days ago</div>
                        <span class="similar-badge ${badgeClass}">${badge}</span>
                    </div>
                </a>
            `;
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
                    <span style="font-family: var(--spy-font-mono)">${formatCurrency(p.val, data.currentPriceStr)}</span>
                </div>
                <div class="market-bar-wrapper">
                    <div class="market-bar" style="width: ${(p.val / maxVal) * 100}%; background-color: ${p.color};"></div>
                </div>
            </div>
        `).join('');
    }

    function renderSellerTab(data) {
        const scoreData = calculateSellerScore(data);
        return `
            <div class="seller-stats-header">
                <div class="seller-avatar-placeholder">${data.seller.initials}</div>
                <div class="seller-meta">
                    <div class="seller-username-row">
                        @${data.seller.username} ${data.seller.isVerified ? '<span class="verified-badge">✓</span>' : ''}
                    </div>
                    <div class="seller-rating-row">
                        <span class="star-rating">${"★".repeat(Math.round(data.seller.rating))}${"☆".repeat(5 - Math.round(data.seller.rating))}</span>
                        <span>(${data.seller.reviews} REVIEWS)</span>
                    </div>
                </div>
            </div>

            <div class="intelligence-score-section">
                <div class="score-header">
                    <div class="score-title">
                        OFFER INTELLIGENCE
                        <span class="info-tooltip-trigger">ⓘ
                            <div class="info-tooltip">Predicts seller motivation based on listing age, price drops, and market demand.</div>
                        </span>
                    </div>
                    <div class="score-verdict" style="color: ${scoreData.color}">${scoreData.verdict}</div>
                </div>
                <div class="score-progress-bar">
                    <div class="score-fill" style="width: ${scoreData.normalized * 10}%; background-color: ${scoreData.color}"></div>
                </div>
                <ul class="score-bullets">
                    ${scoreData.bullets.map(b => `<li><span>${b.icon}</span> ${b.text}</li>`).join('')}
                </ul>
            </div>

            <div class="offer-calculator-section">
                <div class="calculator-title">INTERACTIVE OFFER CALCULATOR</div>
                <div class="calculator-input-row">
                    <input type="number" class="offer-input" placeholder="ENTER OFFER AMOUNT" />
                    <button class="analyze-btn">ANALYZE</button>
                </div>
                <div class="calculator-results" style="display: none;">
                    <div class="results-verdict"></div>
                    <div class="results-explanation"></div>
                    <div class="sweet-spot-box"></div>
                </div>
            </div>
        `;
    }

    function calculateSellerScore(data) {
        let raw = 0;
        const bullets = [];
        if (data.daysListed > 30) { raw += 3; bullets.push({ icon: "⏳", text: "Listed over 30 days ago (High motivation)" }); }
        else if (data.daysListed > 14) { raw += 1; bullets.push({ icon: "📅", text: "Listed for 2 weeks" }); }
        else { raw -= 1; bullets.push({ icon: "✨", text: "Fresh listing (Lower motivation)" }); }
        if (data.priceHistory.length > 1 && data.priceHistory[0].price > data.currentPrice) {
            raw += 3; bullets.push({ icon: "📉", text: "Seller has already dropped price" });
        }
        if (data.soldData.avg > 0) {
            if (data.currentPrice > data.soldData.avg * 1.1) { raw += 2; bullets.push({ icon: "💰", text: "Priced above market average" }); }
            else if (data.currentPrice < data.soldData.avg * 0.9) { raw -= 2; bullets.push({ icon: "🏷️", text: "Already priced competitively" }); }
        }
        if (data.demand.bags > 15) { raw -= 2; bullets.push({ icon: "🔥", text: "High interest (Many people have in bag)" }); }
        if (data.seller.reviews < 25) { raw += 1; bullets.push({ icon: "🆕", text: "Newer seller (More flexible)" }); }
        else if (data.seller.reviews > 100) { raw -= 1; bullets.push({ icon: "✅", text: "Experienced seller (Knows market value)" }); }
        const normalized = Math.max(0, Math.min(10, ((raw + 5) / 15) * 10));
        let verdict = "Uncertain ⚪";
        let color = "#94a3b8";
        if (raw >= 6) { verdict = "Very Likely ✅"; color = "#22c55e"; }
        else if (raw >= 3) { verdict = "Likely 🟡"; color = "#eab308"; }
        else if (raw >= 1) { verdict = "Uncertain ⚪"; color = "#94a3b8"; }
        else if (raw <= 0) { verdict = "Unlikely 🔴"; color = "#ef4444"; }
        return { raw, normalized, verdict, color, bullets };
    }

    function setupSellerInteractions(modal, data) {
        const input = modal.querySelector('.offer-input');
        const btn = modal.querySelector('.analyze-btn');
        const results = modal.querySelector('.calculator-results');
        const verdict = modal.querySelector('.results-verdict');
        const explanation = modal.querySelector('.results-explanation');
        const sweetSpot = modal.querySelector('.sweet-spot-box');
        if (!btn) return;
        btn.onclick = () => {
            const offer = parseFloat(input.value);
            if (isNaN(offer) || offer <= 0) return;

            // Show spinner during analysis
            results.style.display = 'block';
            verdict.innerText = 'Analyzing...';
            verdict.style.color = '#94a3b8';
            explanation.innerText = '';
            sweetSpot.style.display = 'none';

            setTimeout(() => {
                // 1. Get base seller score
                const baseScore = calculateSellerScore(data).raw;

                // 2. Calculate offer score
                let offerScore = 0;
                const percentOfAsk = (offer / data.currentPrice) * 100;
                const belowAsk = data.currentPrice - offer;
                const percentBelowAsk = (belowAsk / data.currentPrice) * 100;

                // Points based on % below asking
                if (percentBelowAsk <= 10) {
                    offerScore += 3;
                } else if (percentBelowAsk <= 20) {
                    offerScore += 1;
                } else if (percentBelowAsk <= 30) {
                    offerScore -= 1;
                } else {
                    offerScore -= 3;
                }

                // Points based on avg sold comparison
                if (data.soldData.avg > 0) {
                    const diffFromAvg = data.soldData.avg - offer;
                    if (offer > data.soldData.avg) {
                        offerScore += 2;
                    } else if (diffFromAvg <= 5) {
                        offerScore += 1;
                    } else if (diffFromAvg <= 15) {
                        offerScore -= 1;
                    } else {
                        offerScore -= 3;
                    }
                }

                // 3. Combined score
                const combined = baseScore + offerScore;

                // 4. Determine verdict and color
                let resultVerdict = "";
                let resultColor = "";
                if (combined >= 8) {
                    resultVerdict = "Strong chance of acceptance ✅";
                    resultColor = "#22c55e";
                } else if (combined >= 4) {
                    resultVerdict = "Decent shot 🟡";
                    resultColor = "#eab308";
                } else if (combined >= 1) {
                    resultVerdict = "Slim chance ⚠️";
                    resultColor = "#f97316";
                } else {
                    resultVerdict = "Very likely declined ❌";
                    resultColor = "#ef4444";
                }

                // 5. Generate explanation
                let motivationText = "";
                if (data.daysListed > 30) {
                    motivationText = "The seller appears motivated (listed 30+ days).";
                } else if (data.priceHistory.length > 1 && data.priceHistory[0].price > data.currentPrice) {
                    motivationText = "The seller has already dropped the price, suggesting flexibility.";
                } else if (data.daysListed > 14) {
                    motivationText = "The seller may be willing to negotiate.";
                } else {
                    motivationText = "The seller is less likely to negotiate on a fresh listing.";
                }

                let soldComparison = "";
                if (data.soldData.avg > 0) {
                    if (offer > data.soldData.avg) {
                        soldComparison = ` Your offer is above the market average (${formatCurrency(data.soldData.avg, data.currentPriceStr)}).`;
                    } else {
                        const belowAvg = Math.round(((data.soldData.avg - offer) / data.soldData.avg) * 100);
                        soldComparison = ` Your offer is ${belowAvg}% below market average.`;
                    }
                }

                const resultExp = `Your offer of ${formatCurrency(offer, data.currentPriceStr)} is ${Math.round(percentBelowAsk)}% below asking. ${motivationText}${soldComparison}`;

                // 6. Calculate sweet spot
                let sweetSpotPrice = 0;
                if (data.soldData.avg > 0) {
                    if (baseScore >= 5) {
                        sweetSpotPrice = Math.max(offer, data.soldData.avg * 0.90);
                    } else if (baseScore >= 2) {
                        sweetSpotPrice = data.soldData.avg * 0.95;
                    } else {
                        sweetSpotPrice = data.currentPrice * 0.92;
                    }
                } else {
                    sweetSpotPrice = data.currentPrice * 0.85;
                }

                // Update results
                verdict.innerText = resultVerdict;
                verdict.style.color = resultColor;
                explanation.innerText = resultExp;
                sweetSpot.style.display = 'block';
                sweetSpot.innerText = `💡 Sweet spot: ~${formatCurrency(sweetSpotPrice, data.currentPriceStr)}`;
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
        const w = rect.width;
        const h = rect.height;
        const padding = 35;
        const graphW = w - padding * 2;
        const graphH = h - padding * 2;
        const prices = history.map(h => h.price);
        if (avgSold > 0) prices.push(avgSold);
        const minP = Math.min(...prices) * 0.95;
        const maxP = Math.max(...prices) * 1.05;
        const rangeP = maxP - minP;
        const getX = (i) => padding + (i / (history.length - 1)) * graphW;
        const getY = (p) => padding + graphH - ((p - minP) / rangeP) * graphH;

        // Detect theme using real DOM attribute
        const card = document.querySelector('.price-spy-card');
        const isDark = card?.getAttribute('data-theme') === 'dark';

        // All colors as real hex — CSS variables don't work on canvas
        const accentColor = '#ff4e00';
        const textColor = isDark ? '#9ca3af' : '#6b7280';
        const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
        const dotBorderColor = isDark ? '#1a1a1a' : '#ffffff';

        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, padding + graphH);
        ctx.lineTo(padding + graphW, padding + graphH);
        ctx.stroke();

        // X axis date labels
        ctx.fillStyle = textColor;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        history.forEach((entry, i) => {
            if (history.length > 6 && i % Math.ceil(history.length / 5) !== 0) return;
            const x = getX(i);
            const date = new Date(entry.timestamp);
            const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            ctx.fillText(label, x, padding + graphH + 15);
        });

        // Y axis price labels
        ctx.textAlign = 'right';
        ctx.fillText(formatCurrency(maxP, '$'), padding - 5, padding + 5);
        ctx.fillText(formatCurrency(minP, '$'), padding - 5, padding + graphH);

        // Avg sold dashed line
        if (avgSold > 0) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1;
            const avgY = getY(avgSold);
            ctx.beginPath();
            ctx.moveTo(padding, avgY);
            ctx.lineTo(padding + graphW, avgY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#22c55e';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Avg Sold', padding + graphW - 55, avgY - 5);
        }

        // Price line — FIXED: was using var(--spy-accent)
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        history.forEach((entry, i) => {
            const x = getX(i);
            const y = getY(entry.price);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Dots — FIXED: was using var(--spy-accent)
        history.forEach((entry, i) => {
            const x = getX(i);
            const y = getY(entry.price);
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = dotBorderColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
    }
    //end

    // --- SPA & Navigation ---
    
    let lastUrl = location.href;
    let lastProductId = "";
    function getProductId() {
        const match = location.href.match(/\/products\/([^\/?#]+)/);
        return match ? match[1] : "";
    }
    const observer = new MutationObserver(() => {
        const currentUrl = location.href;
        const currentProductId = getProductId();
        if (currentUrl !== lastUrl || currentProductId !== lastProductId) {
            lastUrl = currentUrl;
            lastProductId = currentProductId;
            if (currentUrl.includes('/products/')) {
                const existing = document.querySelector('.price-spy-card');
                if (existing) existing.remove();
                setTimeout(init, 1500);
            }
        }
    });
    observer.observe(document, { subtree: true, childList: true });
    window.addEventListener('popstate', () => setTimeout(init, 1000));

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'DEPOP_API_RESPONSE') {
            const { url, data } = event.data;
            if (location.href.includes('/products/') && url.includes('/products/')) {
                const product = data.product || data.listing || data;
                if (product && product.id) {
                    init(product);
                }
            }
        }
    });

    if (location.href.includes('/products/')) {
        const checkTitle = setInterval(() => {
            if (document.querySelector('h1')) {
                clearInterval(checkTitle);
                init();
            }
        }, 500);
        setTimeout(() => clearInterval(checkTitle), 5000);
    }

})();
