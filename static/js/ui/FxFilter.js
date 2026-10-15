/**
 * FxFilter.js - Apple-style Liquid Glass Effects
 * SVG filter-based visual effects for glassmorphism UI
 *
 * Inspired by iOS 18+ liquid glass design language
 */

const FxFilter = (() => {
    // Store for custom effect definitions
    const customEffects = {};

    // Unique ID counter for filters
    let filterId = 0;

    // Map to track elements and their filters
    const elementFilters = new WeakMap();

    // Container for SVG filters
    let svgContainer = null;

    /**
     * Initialize the filter system
     */
    function init() {
        if (svgContainer) return;

        // Create hidden SVG container for filter definitions
        svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgContainer.setAttribute('class', 'fx-filter-container');
        svgContainer.setAttribute('width', '0');
        svgContainer.setAttribute('height', '0');
        svgContainer.setAttribute('aria-hidden', 'true');
        svgContainer.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';

        document.body.appendChild(svgContainer);

        // Observe DOM for new elements with --fx-filter
        observeDOM();

        // Process existing elements
        processElements();

        // Watch for theme changes
        observeThemeChanges();

        console.log('[FxFilter] Initialized');
    }

    /**
     * Create the liquid glass SVG filter
     * @param {number} refraction - Distortion intensity (0.5-5)
     * @param {number} offset - Edge blur/offset (5-20)
     * @param {number} chromatic - Chromatic aberration (0-1)
     * @returns {string} SVG filter primitives
     */
    function createLiquidGlassFilter(refraction = 2, offset = 10, chromatic = 0.5) {
        const turbScale = 0.015 + (refraction * 0.005);
        const displacementScale = offset * refraction;

        let filter = `
            <!-- Turbulence for organic distortion -->
            <feTurbulence
                type="fractalNoise"
                baseFrequency="${turbScale}"
                numOctaves="3"
                result="noise"
                seed="${Math.floor(Math.random() * 1000)}"
            />

            <!-- Displacement map for glass refraction -->
            <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="${displacementScale}"
                xChannelSelector="R"
                yChannelSelector="G"
                result="displaced"
            />
        `;

        // Add chromatic aberration if enabled
        if (chromatic > 0) {
            const chromaticOffset = chromatic * 2;
            filter += `
                <!-- Chromatic aberration - separate RGB channels -->
                <feOffset in="displaced" dx="${-chromaticOffset}" dy="0" result="redShift"/>
                <feOffset in="displaced" dx="${chromaticOffset}" dy="0" result="blueShift"/>

                <!-- Recombine with color matrix -->
                <feColorMatrix in="redShift" type="matrix"
                    values="1 0 0 0 0
                            0 0 0 0 0
                            0 0 0 0 0
                            0 0 0 1 0" result="red"/>
                <feColorMatrix in="displaced" type="matrix"
                    values="0 0 0 0 0
                            0 1 0 0 0
                            0 0 0 0 0
                            0 0 0 1 0" result="green"/>
                <feColorMatrix in="blueShift" type="matrix"
                    values="0 0 0 0 0
                            0 0 0 0 0
                            0 0 1 0 0
                            0 0 0 1 0" result="blue"/>

                <!-- Merge RGB channels -->
                <feBlend mode="screen" in="red" in2="green" result="rg"/>
                <feBlend mode="screen" in="rg" in2="blue" result="chromatic"/>
                <feMerge>
                    <feMergeNode in="chromatic"/>
                </feMerge>
            `;
        }

        return filter;
    }

    /**
     * Create noise texture filter
     * @param {number} saturation - Color saturation (0 = grayscale, 1 = full color)
     * @param {number} intensity - Noise intensity (0.1-2)
     * @param {number} opacity - Noise opacity (0-1)
     * @returns {string} SVG filter primitives
     */
    function createNoiseFilter(saturation = 0, intensity = 0.5, opacity = 0.1) {
        return `
            <!-- Generate noise pattern -->
            <feTurbulence
                type="fractalNoise"
                baseFrequency="0.8"
                numOctaves="4"
                result="noise"
                stitchTiles="stitch"
            />

            <!-- Desaturate if needed -->
            <feColorMatrix
                in="noise"
                type="saturate"
                values="${saturation}"
                result="coloredNoise"
            />

            <!-- Adjust intensity -->
            <feComponentTransfer in="coloredNoise" result="adjustedNoise">
                <feFuncR type="linear" slope="${intensity}" intercept="0"/>
                <feFuncG type="linear" slope="${intensity}" intercept="0"/>
                <feFuncB type="linear" slope="${intensity}" intercept="0"/>
                <feFuncA type="linear" slope="${opacity}" intercept="0"/>
            </feComponentTransfer>

            <!-- Blend with source -->
            <feBlend in="SourceGraphic" in2="adjustedNoise" mode="overlay" result="noisy"/>
        `;
    }

    /**
     * Create color overlay filter
     * @param {string} color - Color value (e.g., 'black', 'white', '#000')
     * @param {number} opacity - Overlay opacity (0-1)
     * @returns {string} SVG filter primitives
     */
    function createColorOverlay(color = 'black', opacity = 0.3) {
        // Convert color to RGB
        let r = 0, g = 0, b = 0;
        if (color === 'black') {
            r = g = b = 0;
        } else if (color === 'white') {
            r = g = b = 1;
        } else if (color.startsWith('#')) {
            const hex = color.slice(1);
            r = parseInt(hex.substr(0, 2), 16) / 255;
            g = parseInt(hex.substr(2, 2), 16) / 255;
            b = parseInt(hex.substr(4, 2), 16) / 255;
        }

        return `
            <!-- Color overlay -->
            <feColorMatrix type="matrix"
                values="${1-opacity} 0 0 0 ${r * opacity}
                        0 ${1-opacity} 0 0 ${g * opacity}
                        0 0 ${1-opacity} 0 ${b * opacity}
                        0 0 0 1 0"
            />
        `;
    }

    /**
     * Create a complete filter from a filter string
     * @param {string} filterString - The --fx-filter value
     * @returns {string} Complete SVG filter element
     */
    function createFilter(filterString) {
        const id = `fx-filter-${++filterId}`;
        let filterContent = '';

        // Parse the filter string
        const effects = parseFilterString(filterString);

        effects.forEach(effect => {
            switch (effect.name) {
                case 'liquid-glass':
                    filterContent += createLiquidGlassFilter(
                        effect.params[0] || 2,
                        effect.params[1] || 10,
                        effect.params[2] || 0.5
                    );
                    break;
                case 'noise':
                    filterContent += createNoiseFilter(
                        effect.params[0] || 0,
                        effect.params[1] || 0.5,
                        effect.params[2] || 0.1
                    );
                    break;
                case 'color-overlay':
                    filterContent += createColorOverlay(
                        effect.params[0] || 'black',
                        effect.params[1] || 0.3
                    );
                    break;
                case 'blur':
                    filterContent += `<feGaussianBlur stdDeviation="${parseFloat(effect.params[0]) || 4}"/>`;
                    break;
                case 'saturate':
                    filterContent += `<feColorMatrix type="saturate" values="${effect.params[0] || 1}"/>`;
                    break;
                case 'contrast':
                    const c = effect.params[0] || 1;
                    const intercept = (1 - c) / 2;
                    filterContent += `
                        <feComponentTransfer>
                            <feFuncR type="linear" slope="${c}" intercept="${intercept}"/>
                            <feFuncG type="linear" slope="${c}" intercept="${intercept}"/>
                            <feFuncB type="linear" slope="${c}" intercept="${intercept}"/>
                        </feComponentTransfer>
                    `;
                    break;
                case 'brightness':
                    filterContent += `
                        <feComponentTransfer>
                            <feFuncR type="linear" slope="${effect.params[0] || 1}"/>
                            <feFuncG type="linear" slope="${effect.params[0] || 1}"/>
                            <feFuncB type="linear" slope="${effect.params[0] || 1}"/>
                        </feComponentTransfer>
                    `;
                    break;
                default:
                    // Check custom effects
                    if (customEffects[effect.name]) {
                        filterContent += customEffects[effect.name](effect.element, ...effect.params);
                    }
            }
        });

        // Wrap in filter element
        const filterElement = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filterElement.setAttribute('id', id);
        filterElement.setAttribute('x', '-50%');
        filterElement.setAttribute('y', '-50%');
        filterElement.setAttribute('width', '200%');
        filterElement.setAttribute('height', '200%');
        filterElement.setAttribute('color-interpolation-filters', 'sRGB');
        filterElement.innerHTML = filterContent;

        return { id, element: filterElement };
    }

    /**
     * Parse filter string into effects array
     * @param {string} filterString
     * @returns {Array} Array of effect objects
     */
    function parseFilterString(filterString) {
        const effects = [];
        const regex = /(\w+(?:-\w+)*)\(([^)]*)\)/g;
        let match;

        while ((match = regex.exec(filterString)) !== null) {
            const name = match[1];
            const paramsStr = match[2];
            const params = paramsStr.split(',').map(p => {
                p = p.trim();
                // Remove units like 'px'
                if (p.endsWith('px')) {
                    return parseFloat(p);
                }
                // Try to parse as number
                const num = parseFloat(p);
                return isNaN(num) ? p : num;
            });

            effects.push({ name, params });
        }

        return effects;
    }

    /**
     * Apply filter to an element
     * @param {HTMLElement} element
     */
    function applyFilter(element) {
        const filterString = getComputedStyle(element).getPropertyValue('--fx-filter').trim();

        if (!filterString || filterString === 'none') {
            // Remove existing filter
            if (elementFilters.has(element)) {
                const oldFilter = elementFilters.get(element);
                oldFilter.element.remove();
                elementFilters.delete(element);
                element.style.filter = '';
            }
            return;
        }

        // Remove old filter if exists
        if (elementFilters.has(element)) {
            const oldFilter = elementFilters.get(element);
            oldFilter.element.remove();
        }

        // Create new filter
        const { id, element: filterEl } = createFilter(filterString);
        svgContainer.appendChild(filterEl);

        // Apply to element
        element.style.filter = `url(#${id})`;
        elementFilters.set(element, { id, element: filterEl, filterString });
    }

    /**
     * Process all elements with --fx-filter
     */
    function processElements() {
        // Find all elements (use a broad selector, then filter)
        const allElements = document.querySelectorAll('*');

        allElements.forEach(element => {
            const filterString = getComputedStyle(element).getPropertyValue('--fx-filter').trim();
            if (filterString && filterString !== 'none') {
                applyFilter(element);
            }
        });
    }

    /**
     * Observe DOM for changes
     */
    function observeDOM() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                // Check added nodes
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        const filterString = getComputedStyle(node).getPropertyValue('--fx-filter').trim();
                        if (filterString && filterString !== 'none') {
                            applyFilter(node);
                        }
                        // Also check children
                        node.querySelectorAll?.('*').forEach(child => {
                            const childFilter = getComputedStyle(child).getPropertyValue('--fx-filter').trim();
                            if (childFilter && childFilter !== 'none') {
                                applyFilter(child);
                            }
                        });
                    }
                });

                // Check style/class changes
                if (mutation.type === 'attributes') {
                    if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
                        const element = mutation.target;
                        const filterString = getComputedStyle(element).getPropertyValue('--fx-filter').trim();
                        const currentFilter = elementFilters.get(element);

                        if (filterString !== currentFilter?.filterString) {
                            applyFilter(element);
                        }
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }

    /**
     * Watch for theme changes and reprocess filters
     */
    function observeThemeChanges() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.attributeName === 'data-theme') {
                    // Theme changed, reprocess all filters
                    setTimeout(() => {
                        elementFilters.forEach((filter, element) => {
                            applyFilter(element);
                        });
                    }, 50);
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    /**
     * Add a custom effect
     * @param {string} name - Effect name
     * @param {Function} generator - Function that returns SVG filter primitives
     */
    function add(name, generator) {
        customEffects[name] = generator;
    }

    /**
     * Manually apply filter to an element
     * @param {HTMLElement|string} elementOrSelector
     * @param {string} filterString
     */
    function apply(elementOrSelector, filterString) {
        const element = typeof elementOrSelector === 'string'
            ? document.querySelector(elementOrSelector)
            : elementOrSelector;

        if (!element) return;

        element.style.setProperty('--fx-filter', filterString);
        applyFilter(element);
    }

    /**
     * Remove filter from an element
     * @param {HTMLElement|string} elementOrSelector
     */
    function remove(elementOrSelector) {
        const element = typeof elementOrSelector === 'string'
            ? document.querySelector(elementOrSelector)
            : elementOrSelector;

        if (!element) return;

        element.style.removeProperty('--fx-filter');
        if (elementFilters.has(element)) {
            const filter = elementFilters.get(element);
            filter.element.remove();
            elementFilters.delete(element);
            element.style.filter = '';
        }
    }

    /**
     * Refresh all filters (useful after major DOM changes)
     */
    function refresh() {
        processElements();
    }

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        init,
        add,
        apply,
        remove,
        refresh,
        createLiquidGlassFilter,
        createNoiseFilter
    };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FxFilter;
}

// Make globally available
window.FxFilter = FxFilter;
