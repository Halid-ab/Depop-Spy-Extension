(function() {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const url = args[0] instanceof Request ? args[0].url : args[0];
        
        if (url.includes('api.depop.com')) {
            const clone = response.clone();
            try {
                const data = await clone.json();
                window.postMessage({ type: 'DEPOP_API_RESPONSE', url, data }, '*');
            } catch (e) {}
        }
        return response;
    };

    const originalXHR = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        this.addEventListener('load', function() {
            if (url.includes('api.depop.com')) {
                try {
                    const data = JSON.parse(this.responseText);
                    window.postMessage({ type: 'DEPOP_API_RESPONSE', url, data }, '*');
                } catch (e) {}
            }
        });
        return originalXHR.apply(this, arguments);
    };
})();
