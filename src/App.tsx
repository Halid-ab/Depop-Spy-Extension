import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('history');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [offerInput, setOfferInput] = useState('');
  const [offerAnalysis, setOfferAnalysis] = useState<{ verdict: string, color: string, explanation: string, sweetSpot: number } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const mockData = {
    daysListed: 12,
    priceDropFrom: 55,
    avgSoldPrice: 42.50,
    minSold: 35,
    maxSold: 60,
    currentPrice: 45,
    currentPriceStr: "$45.00",
    rating: "Fair Price",
    ratingClass: "rating-fair",
    diffPercent: 6,
    suggestedOffer: 38,
    activeListings: [
      { title: "Essentials Tee Black", price: 38, img: "https://picsum.photos/seed/1/50/50", url: "#", daysAgo: 5 },
      { title: "FOG Essentials Shirt", price: 42, img: "https://picsum.photos/seed/2/50/50", url: "#", daysAgo: 12 },
      { title: "Fear of God Tee", price: 45, img: "https://picsum.photos/seed/3/50/50", url: "#", daysAgo: 2 },
      { title: "Essentials T-Shirt New", price: 50, img: "https://picsum.photos/seed/4/50/50", url: "#", daysAgo: 20 },
      { title: "Authentic FOG Tee", price: 55, img: "https://picsum.photos/seed/5/50/50", url: "#", daysAgo: 8 },
      { title: "Essentials Black Tee", price: 60, img: "https://picsum.photos/seed/6/50/50", url: "#", daysAgo: 15 },
    ],
    priceHistory: [
      { price: 60, timestamp: Date.now() - 86400000 * 10 },
      { price: 55, timestamp: Date.now() - 86400000 * 7 },
      { price: 55, timestamp: Date.now() - 86400000 * 4 },
      { price: 45, timestamp: Date.now() - 86400000 * 1 },
    ],
    demand: {
      bags: 14,
      offers: 3,
      heat: "Warm",
      heatClass: "heat-warm"
    },
    seller: {
      username: "vintage_vibes",
      rating: 4.9,
      reviews: 124,
      isVerified: true,
      initials: "V"
    }
  };

  useEffect(() => {
    if (isModalOpen && activeTab === 'history' && canvasRef.current) {
      setTimeout(drawGraph, 100);
    }
  }, [isModalOpen, activeTab, isDarkMode]);

  const handleAnalyzeOffer = () => {
    const offer = parseFloat(offerInput);
    if (!offer || offer <= 0) return;

    setIsAnalyzing(true);
    setTimeout(() => {
      const pctOfAsking = (offer / mockData.currentPrice) * 100;
      let verdict = "Slim chance ⚠️";
      let color = "#f97316";
      
      if (pctOfAsking > 85) { verdict = "Strong chance ✅"; color = "#22c55e"; }
      else if (pctOfAsking > 75) { verdict = "Decent shot 🟡"; color = "#eab308"; }
      else if (pctOfAsking < 60) { verdict = "Likely declined ❌"; color = "#ef4444"; }

      setOfferAnalysis({
        verdict,
        color,
        explanation: `Your offer is ${Math.round(100 - pctOfAsking)}% below asking. The seller's motivation helps your case.`,
        sweetSpot: mockData.currentPrice * 0.82
      });
      setIsAnalyzing(false);
    }, 800);
  };

  const drawGraph = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const cw = w / 2;
    const ch = h / 2;

    const padding = 30;
    const graphW = cw - padding * 2;
    const graphH = ch - padding * 2;

    const prices = mockData.priceHistory.map(h => h.price);
    prices.push(mockData.avgSoldPrice);
    const minP = Math.min(...prices) * 0.9;
    const maxP = Math.max(...prices) * 1.1;
    const rangeP = maxP - minP;

    const getX = (i: number) => padding + (i / (mockData.priceHistory.length - 1)) * graphW;
    const getY = (p: number) => padding + graphH - ((p - minP) / rangeP) * graphH;

    ctx.clearRect(0, 0, cw, ch);

    const textColor = isDarkMode ? '#ffffff' : '#1a1a1a';

    // Avg Sold Line
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1;
    const avgY = getY(mockData.avgSoldPrice);
    ctx.beginPath();
    ctx.moveTo(padding, avgY);
    ctx.lineTo(padding + graphW, avgY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('Avg Sold', padding + graphW - 45, avgY - 5);

    // Main Line
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    mockData.priceHistory.forEach((entry, i) => {
      const x = getX(i);
      const y = getY(entry.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Points
    mockData.priceHistory.forEach((entry, i) => {
      const x = getX(i);
      const y = getY(entry.price);
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Labels
    ctx.fillStyle = textColor;
    ctx.font = '9px sans-serif';
    ctx.fillText(`$${minP.toFixed(0)}`, 5, padding + graphH);
    ctx.fillText(`$${maxP.toFixed(0)}`, 5, padding);
  };

  const simulateLoading = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 2000);
  };

  const themeClass = isDarkMode ? "bg-[#0a0a0a] text-white" : "bg-white text-[#1a1a1a]";
  const cardTheme = isDarkMode ? "bg-[#1a1a1a] text-white border-[#333]" : "bg-[#f5f5f5] text-[#1a1a1a] border-[#e0e0e0]";
  const dividerTheme = isDarkMode ? "border-[#333]" : "border-[#e0e0e0]";
  const tabBg = isDarkMode ? "bg-white/5" : "bg-black/5";

  return (
    <div className={`min-h-screen p-8 transition-colors duration-300 ${themeClass}`}>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-2xl font-bold">Depop Price Spy Preview</h1>
            <p className="text-sm opacity-50">Visualizing the expanded analysis card</p>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={simulateLoading}
              className="px-4 py-2 rounded-full border border-current text-sm font-medium hover:opacity-80 transition-opacity"
            >
              Simulate Loading
            </button>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="px-4 py-2 rounded-full border border-current text-sm font-medium hover:opacity-80 transition-opacity"
            >
              Switch to {isDarkMode ? 'Light' : 'Dark'} Mode
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <div className="aspect-[3/4] bg-gray-800 rounded-lg overflow-hidden relative">
              <img 
                src="https://picsum.photos/seed/depop/800/1000" 
                alt="Product" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm opacity-60 uppercase tracking-widest">Fear of God</p>
              <h2 className="text-3xl font-bold">Fear of God Essentials T-Shirt</h2>
              <div className="flex items-center gap-4">
                <span className="text-2xl font-bold">$45.00</span>
                <span className="text-lg line-through opacity-40">$120.00</span>
                <span className="bg-red-500 text-white px-2 py-1 text-xs font-bold rounded">62% OFF</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button className="flex-1 bg-black text-white dark:bg-white dark:text-black py-4 font-bold rounded-md">Buy now</button>
            </div>
            
            <div className="flex gap-3">
              <button className="flex-1 border border-current py-3 font-bold rounded-md">Make offer</button>
              <button className="flex-1 border border-current py-3 font-bold rounded-md">Add to bag</button>
            </div>

            {/* THE SPY CARD */}
            <div className={`w-[360px] rounded-xl border shadow-2xl transition-all duration-300 overflow-hidden ${cardTheme}`}>
              <div className="p-5">
                <div className="flex items-center gap-2 font-black text-sm tracking-widest mb-4">
                  🕵️ DEPOP PRICE SPY
                </div>

                {isLoading ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-4">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-bold animate-pulse opacity-60 uppercase tracking-widest">Analyzing listing data...</p>
                  </div>
                ) : (
                  <>
                    <div className={`pb-4 mb-4 border-b ${dividerTheme}`}>
                      <div className="text-[10px] font-bold uppercase opacity-50 mb-3 tracking-wider">Price Intelligence</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-[10px] opacity-60 uppercase mb-1">Avg Sold</div>
                          <div className="text-sm font-bold">${mockData.avgSoldPrice.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] opacity-60 uppercase mb-1">Sold Range</div>
                          <div className="text-sm font-bold">${mockData.minSold} – ${mockData.maxSold}</div>
                        </div>
                        <div>
                          <div className="text-[10px] opacity-60 uppercase mb-1">Days Listed</div>
                          <div className="text-sm font-bold">{mockData.daysListed} days</div>
                        </div>
                        <div>
                          <div className="text-[10px] opacity-60 uppercase mb-1">Similar Active</div>
                          <div className="text-sm font-bold">{mockData.activeListings.length} items</div>
                        </div>
                      </div>
                      <div className="text-[#22c55e] text-xs font-bold mt-3">📉 Dropped from $60.00</div>
                    </div>

                    <div className={`pb-4 mb-4 border-b ${dividerTheme}`}>
                      <div className="text-[10px] font-bold uppercase opacity-50 mb-3 tracking-wider">Deal Analysis</div>
                      <div className="flex gap-2">
                        <span className="bg-[#eab308] text-black px-2 py-1 rounded text-[11px] font-bold">Fair Price</span>
                        <span className="bg-gray-500/10 px-2 py-1 rounded text-[11px] font-bold">6% above market</span>
                      </div>
                    </div>

                    <div className={`pb-4 mb-4 border-b ${dividerTheme}`}>
                      <div className="text-[10px] font-bold uppercase opacity-50 mb-3 tracking-wider">Demand Signals</div>
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <div className="text-[10px] opacity-60 uppercase mb-1">In Bags</div>
                          <div className="text-sm font-bold">{mockData.demand.bags} people</div>
                        </div>
                        <div>
                          <div className="text-[10px] opacity-60 uppercase mb-1">Offers Sent</div>
                          <div className="text-sm font-bold">{mockData.demand.offers}</div>
                        </div>
                      </div>
                      <span className="bg-[#f97316] text-white px-2 py-1 rounded text-[11px] font-bold">Warm Demand</span>
                    </div>

                    <div className="pt-2">
                      <div className="text-[10px] font-bold uppercase opacity-50 mb-3 tracking-wider">Negotiation Helper</div>
                      <div className="bg-blue-500/10 p-3 rounded-lg text-sm font-bold flex items-center gap-2">
                        💡 Try offering ${mockData.suggestedOffer}
                      </div>
                    </div>

                    {!isModalOpen && (
                      <button 
                        onClick={() => setIsModalOpen(true)}
                        className="w-full mt-4 py-2 text-[10px] font-bold uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity"
                      >
                        See Full Analysis ▼
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* MODAL OVERLAY */}
            {isModalOpen && (
              <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                <div 
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={() => setIsModalOpen(false)}
                />
                <div className={`relative w-full max-w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl animate-in fade-in zoom-in duration-300 ${cardTheme}`}>
                  <button 
                    onClick={() => setIsModalOpen(false)}
                    className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-500/10 hover:bg-gray-500/20 transition-colors font-bold"
                  >
                    ×
                  </button>

                  <div className={`flex sticky top-0 z-10 border-b ${dividerTheme} ${cardTheme}`}>
                    {['history', 'similar', 'market', 'seller'].map(tab => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-tighter transition-all ${activeTab === tab ? 'opacity-100 border-b-2 border-current' : 'opacity-40'}`}
                      >
                        {tab === 'history' && '📈 History'}
                        {tab === 'similar' && '🔍 Similar'}
                        {tab === 'market' && '📊 Market'}
                        {tab === 'seller' && '🏪 Seller'}
                      </button>
                    ))}
                  </div>

                  <div className="p-6">
                    {activeTab === 'history' && (
                      <div className="space-y-6">
                        <div className="relative">
                          <canvas ref={canvasRef} className="w-full h-[180px] bg-gray-500/5 rounded-lg" />
                        </div>
                        <div className="text-xs space-y-2 opacity-80">
                          <div className="flex justify-between">
                            <span><b>First seen:</b></span>
                            <span>3/21/2026 at $60.00</span>
                          </div>
                          <div className="flex justify-between">
                            <span><b>Current price:</b></span>
                            <span>$45.00</span>
                          </div>
                          <div className="flex justify-between text-green-500 font-bold">
                            <span><b>Total drop:</b></span>
                            <span>$15.00 (25% decrease)</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'similar' && (
                      <div className="space-y-4">
                        <div className="flex gap-2 text-[9px] font-bold opacity-50 uppercase">
                          Sort: <span className="underline cursor-pointer">Price Low</span> | <span className="underline cursor-pointer">Price High</span> | <span className="underline cursor-pointer">Newest</span>
                        </div>
                        <div className="space-y-3">
                          {mockData.activeListings.map((item, i) => (
                            <div key={i} className="flex items-center gap-4 p-3 hover:bg-gray-500/5 rounded-xl transition-colors cursor-pointer border border-transparent hover:border-current/10">
                              <img src={item.img} className="w-12 h-12 rounded-lg object-cover" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold truncate">{item.title}</p>
                                <p className="text-xs font-black mt-0.5">${item.price}</p>
                                <p className="text-[10px] opacity-50">Listed {item.daysAgo} days ago</p>
                              </div>
                              <span className={`text-[9px] font-bold px-2 py-1 rounded ${item.price < 40 ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-500'}`}>
                                {item.price < 40 ? 'Great Deal' : 'Fair Price'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTab === 'market' && (
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Active Market</p>
                          {[
                            { label: "This Item", val: 45, color: "bg-blue-500" },
                            { label: "Market Avg", val: 48.20, color: "bg-gray-500" },
                            { label: "Lowest Active", val: 38, color: "bg-yellow-500" }
                          ].map((bar, i) => (
                            <div key={i} className="space-y-1.5">
                              <div className="flex justify-between text-[10px] font-bold uppercase opacity-60">
                                <span>{bar.label}</span>
                                <span>${bar.val.toFixed(2)}</span>
                              </div>
                              <div className="h-2.5 bg-gray-500/10 rounded-full overflow-hidden">
                                <div className={`h-full ${bar.color} transition-all duration-1000`} style={{ width: `${(bar.val / 60) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-4 pt-4 border-t border-current/10">
                          <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Sold Market</p>
                          {[
                            { label: "Avg Sold", val: 42.5, color: "bg-green-500" },
                            { label: "Sold Range", val: 35, val2: 60, color: "bg-green-500/30" }
                          ].map((bar, i) => (
                            <div key={i} className="space-y-1.5">
                              <div className="flex justify-between text-[10px] font-bold uppercase opacity-60">
                                <span>{bar.label}</span>
                                <span>{bar.val2 ? `$${bar.val} - $${bar.val2}` : `$${bar.val.toFixed(2)}`}</span>
                              </div>
                              {bar.val2 ? (
                                <div className="h-2.5 bg-gray-500/10 rounded-full overflow-hidden relative">
                                  <div 
                                    className={`absolute h-full ${bar.color}`} 
                                    style={{ left: `${(bar.val / 60) * 100}%`, width: `${((bar.val2 - bar.val) / 60) * 100}%` }} 
                                  />
                                </div>
                              ) : (
                                <div className="h-2.5 bg-gray-500/10 rounded-full overflow-hidden">
                                  <div className={`h-full ${bar.color} transition-all duration-1000`} style={{ width: `${(bar.val / 60) * 100}%` }} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-current/10">
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase opacity-50">Market Supply</p>
                            <p className="text-xs font-bold">Low (Seller's Market)</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase opacity-50">Sell-through</p>
                            <p className="text-xs font-bold">High Demand</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'seller' && (
                      <div className="space-y-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-xl">
                            {mockData.seller.initials}
                          </div>
                          <div>
                            <div className="flex items-center gap-1 font-bold">
                              @{mockData.seller.username}
                              {mockData.seller.isVerified && <span className="text-blue-500 text-xs">✓</span>}
                            </div>
                            <div className="text-xs opacity-60">
                              <span className="text-yellow-500">★★★★★</span> ({mockData.seller.reviews} reviews)
                            </div>
                          </div>
                        </div>

                        <div className="bg-gray-500/5 p-4 rounded-xl space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold uppercase opacity-50">Offer Intelligence Score</span>
                            <span className="text-xs font-bold text-green-500">Very Likely ✅</span>
                          </div>
                          <div className="h-2 bg-gray-500/10 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 w-[85%]" />
                          </div>
                          <ul className="text-[11px] space-y-2 opacity-80">
                            <li className="flex gap-2"><span>⏳</span> Listed over 30 days ago (High motivation)</li>
                            <li className="flex gap-2"><span>📉</span> Seller has already dropped price</li>
                            <li className="flex gap-2"><span>💰</span> Priced above market average</li>
                          </ul>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-current/10">
                          <p className="text-xs font-bold">Interactive Offer Calculator</p>
                          <div className="flex gap-2">
                            <input 
                              type="number" 
                              value={offerInput}
                              onChange={(e) => setOfferInput(e.target.value)}
                              placeholder="Enter offer ($)"
                              className={`flex-1 px-3 py-2 rounded-lg border ${dividerTheme} bg-transparent text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500`}
                            />
                            <button 
                              onClick={handleAnalyzeOffer}
                              disabled={isAnalyzing}
                              className="px-4 py-2 bg-current text-white dark:text-black rounded-lg text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                            >
                              {isAnalyzing ? '...' : 'Analyze'}
                            </button>
                          </div>

                          {offerAnalysis && (
                            <div className="bg-blue-500/5 p-4 rounded-xl animate-in fade-in slide-in-from-top-2 duration-300">
                              <p className="text-sm font-bold mb-1" style={{ color: offerAnalysis.color }}>{offerAnalysis.verdict}</p>
                              <p className="text-[11px] opacity-70 leading-relaxed">{offerAnalysis.explanation}</p>
                              <div className="mt-3 p-2 bg-green-500/10 rounded-lg text-[11px] font-bold text-green-500 text-center">
                                🎯 Sweet Spot: ${offerAnalysis.sweetSpot.toFixed(2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-8 opacity-20">
            <h3 className="text-xl font-bold mb-4">More from this seller</h3>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="aspect-square bg-gray-800 rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
