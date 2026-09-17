/*
 * Makes the legacy crawler resilient to Puppeteer navigation races.
 * This is deliberately run before tthc_audit2.js so the crawler can be
 * upgraded without duplicating its large business-logic file.
 */
const fs = require('fs');

const file = 'tthc_audit2.js';
let source = fs.readFileSync(file, 'utf8');

if (source.includes('NAVIGATION_RACE_PATCH_V1')) {
  console.log('Navigation-race patch already applied');
  process.exit(0);
}

const method = `    /** NAVIGATION_RACE_PATCH_V1
     * Execute API calls in the page, but convert navigation races into a
     * retryable result. A redirect/WAF challenge can destroy the execution
     * context while fetch() is running; that must never escape to main().
     */
    async fetchAPI(url, payload) {
        try {
            return await this.page.evaluate(async (url, payload, timeout, referer, origin, secChUa, secChUaMobile, secChUaPlatform) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json, text/plain, */*',
                            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                            'Origin': origin,
                            'Referer': referer,
                            'sec-fetch-site': 'same-origin',
                            'sec-fetch-mode': 'cors',
                            'sec-fetch-dest': 'empty',
                            'sec-ch-ua': secChUa,
                            'sec-ch-ua-mobile': secChUaMobile,
                            'sec-ch-ua-platform': secChUaPlatform,
                        },
                        body: JSON.stringify(payload),
                        credentials: 'include',
                        signal: controller.signal,
                    });
                    if (!response.ok) {
                        return { __error: true, status: response.status, statusText: response.statusText };
                    }
                    return await response.json();
                } catch (err) {
                    return { __error: true, status: 0, statusText: err.message || 'Network Error' };
                } finally {
                    clearTimeout(timer);
                }
            }, url, payload, CONFIG.REQUEST_TIMEOUT,
               CONFIG.API_REFERER, CONFIG.API_ORIGIN,
               this.profile.secChUa, this.profile.secChUaMobile, this.profile.secChUaPlatform);
        } catch (err) {
            // This catch is outside page.evaluate: it catches context-destroyed
            // errors thrown by CDP when the page navigates or is redirected.
            return { __error: true, status: 0, statusText: err.message || 'Page context error' };
        }
    }

`;

const start = source.indexOf('    async fetchAPI(url, payload) {');
const end = source.indexOf('    /** Fetch với retry', start);
if (start < 0 || end < 0) {
  throw new Error('Could not locate fetchAPI in tthc_audit2.js');
}
source = source.slice(0, start) + method + source.slice(end);

// Give a page that was redirected to a challenge page a clean session before
// retrying. The normal exponential retry remains unchanged for other errors.
const needle = `                // Lỗi khác (timeout, network error)\n                if (attempt < CONFIG.MAX_RETRIES) {`;
const replacement = `                // Navigation races leave the page in an unknown document.\n                // Restore the warm session before retrying the API request.\n                if (status === 0 && /Execution context was destroyed|navigation|Target closed|Cannot find context/i.test(result.statusText || '')) {\n                    console.warn('   🔁 Page đã điều hướng giữa request — khôi phục session trước khi thử lại...');\n                    await delay(2000 + attempt * 1000);\n                    try {\n                        await this.page.goto(CONFIG.WARMUP_PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });\n                        await this.warmup();\n                    } catch (recoveryError) {\n                        console.warn(\`   ⚠️ Không thể khôi phục page: \${recoveryError.message}\`);\n                    }\n                }\n\n                // Lỗi khác (timeout, network error)\n                if (attempt < CONFIG.MAX_RETRIES) {`;
if (!source.includes(needle)) {
  throw new Error('Could not locate retry block in tthc_audit2.js');
}
source = source.replace(needle, replacement);
fs.writeFileSync(file, source);
console.log('Applied Puppeteer navigation-race recovery patch');
