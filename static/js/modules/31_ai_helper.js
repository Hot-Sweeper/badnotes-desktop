// ============== AI Helper Module ==============
// AI-powered features using Comet API for math solving, question answering, and general help

const AIHelper = (function() {
    'use strict';

    // System prompts for different modes
    const SYSTEM_PROMPTS = {
        quick: `WICHTIG: Du gibst AUSSCHLIESSLICH das Endergebnis aus. NICHTS ANDERES.

REGELN (STRIKT):
- KEIN Rechenweg, KEINE Erklärung, KEINE Zwischenschritte, KEINE Herleitung
- KEIN LaTeX außer für das Endergebnis selbst
- KEINE Sätze wie "Die Antwort ist..." oder "Ergebnis:"
- Antworte auf Deutsch

FORMAT:
- Mathe: Nur das Ergebnis. z.B. "x = 3" oder "S(0 | 2), T(3 | -1,375)"
- Fragen: Nur die Antwort. z.B. "Paris"
- Mehrere Ergebnisse: Komma-getrennt oder Zeilenweise, NUR die Ergebnisse

Beispiele:
"5+5=" → "10"
"Sattelpunkt und Tiefpunkt von f(x)=..." → "S(0 | 2), T(3 | -1,375)"
"Hauptstadt von Frankreich?" → "Paris"
"Ableitung von x³" → "3x²"`,

        general: `Du bist ein hilfreicher Assistent. Antworte auf Deutsch.
- Sei präzise aber vollständig
- Erkläre wenn nötig
- Formatiere die Antwort übersichtlich
- Setze jede mathematische Formel vollständig in $...$ oder $$...$$. Gib keine rohen LaTeX-Befehle außerhalb dieser Begrenzer aus.`
    };

    let katexPromise=null;
    function loadKaTeX(){
        if(typeof katex!=='undefined')return Promise.resolve(true);
        if(katexPromise)return katexPromise;
        katexPromise=new Promise(resolve=>{
            if(!document.querySelector('[data-ai-math-css]')){
                const css=document.createElement('link');css.rel='stylesheet';css.dataset.aiMathCss='';
                css.href='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';document.head.append(css);
            }
            const script=document.createElement('script');let done=false;
            const finish=ok=>{if(done)return;done=true;clearTimeout(timer);script.onload=script.onerror=null;if(!ok){script.remove();katexPromise=null;}resolve(ok);};
            const timer=setTimeout(()=>finish(false),8000);
            script.src='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
            script.onload=()=>finish(typeof katex!=='undefined');script.onerror=()=>finish(false);document.head.append(script);
        });
        return katexPromise;
    }

    /**
     * Render markdown and LaTeX to HTML
     */
    function renderMarkdownAndLatex(text) {
        if (!text) return '';
        const escapeHtml = value => value.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const tokens = [];
        const protect = html => {
            const marker = `AI_MATH_TOKEN_${tokens.length}_END`;
            tokens.push(html);
            return marker;
        };
        const renderMath = (source, displayMode) => {
            if (typeof katex === 'undefined') return escapeHtml(source);
            try {
                const rendered = katex.renderToString(source.trim(), { displayMode, throwOnError: true });
                return displayMode ? `<div class="ai-latex-block">${rendered}</div>` : rendered;
            } catch (error) {
                return `<code class="ai-code ai-latex-error">${escapeHtml(source)}</code>`;
            }
        };

        let source = text.replace(/\r\n?/g, '\n');
        source = source.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) =>
            protect(`<pre class="ai-code-block"><code>${escapeHtml(code.trimEnd())}</code></pre>`));
        source = source.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, p1, p2) =>
            protect(renderMath(p1 || p2, true)));
        source = source.replace(/\\\(([\s\S]*?)\\\)|(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, p1, p2) =>
            protect(renderMath(p1 || p2, false)));
        // Some models omit math delimiters around set notation.
        source = source.replace(/\b[A-Za-z]_(?:\{\d+\}|\d+)\s*=\s*\\\{[^\n]*?\\\}/g, formula =>
            protect(renderMath(formula, false)));

        const inline = value => {
            let html = escapeHtml(value);
            html = html.replace(/`([^`\n]+)`/g, '<code class="ai-code">$1</code>');
            html = html.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
            html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
            html = html.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
            return html.replace(/AI_MATH_TOKEN_(\d+)_END/g, (_, index) => tokens[Number(index)] || '');
        };

        const blocks = [];
        let paragraph = [];
        let listType = null;
        let listItems = [];
        const flushParagraph = () => {
            if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
            paragraph = [];
        };
        const flushList = () => {
            if (listType) blocks.push(`<${listType} class="ai-list">${listItems.map(item => `<li>${inline(item)}</li>`).join('')}</${listType}>`);
            listType = null;
            listItems = [];
        };

        for (const line of source.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) { flushParagraph(); continue; }
            const list = trimmed.match(/^([-*]|\d+\.)\s+(.+)$/);
            if (list) {
                flushParagraph();
                const type = /\d/.test(list[1]) ? 'ol' : 'ul';
                if (listType && listType !== type) flushList();
                listType = type;
                listItems.push(list[2]);
                continue;
            }
            flushList();
            const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                const level = heading[1].length;
                blocks.push(`<h${level} class="ai-h${level}">${inline(heading[2])}</h${level}>`);
            } else if (/^AI_MATH_TOKEN_\d+_END$/.test(trimmed)) {
                flushParagraph();
                blocks.push(inline(trimmed));
            } else {
                paragraph.push(trimmed);
            }
        }
        flushParagraph();
        flushList();
        return blocks.join('');
    }

    /**
     * Send request to AI via backend proxy
     */
    async function sendToAI(content, mode = 'quick', images = [], model = 'gpt-6-luna') {
        const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.general;

        // In quick mode, wrap user content to reinforce "answer only"
        const quickPrefix = mode === 'quick' ? '[ANTWORT-MODUS: Gib NUR das Endergebnis aus. Kein Rechenweg, keine Erklärung, keine Zwischenschritte, keine Herleitung. NUR die finale Antwort.]\n\n' : '';
        const wrappedContent = quickPrefix + (content || '');

        try {
            // Build messages array
            const messages = [
                { role: 'system', content: systemPrompt }
            ];

            // Build user message with text and images
            if (images.length > 0) {
                const userContent = [];

                // Add text if present
                if (wrappedContent && wrappedContent.trim()) {
                    userContent.push({ type: 'text', text: wrappedContent });
                }

                // Add images
                for (const img of images) {
                    userContent.push({
                        type: 'image_url',
                        image_url: {
                            url: img.startsWith('data:') ? img : `data:image/png;base64,${img}`
                        }
                    });
                }

                messages.push({ role: 'user', content: userContent });
            } else {
                messages.push({ role: 'user', content: wrappedContent });
            }

            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages,
                    model: model,
                    max_tokens: 2048,
                    temperature: 0
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'AI request failed');
            }

            const data = await response.json();
            return data.content || data.choices?.[0]?.message?.content || '';
        } catch (err) {
            console.error('AI Helper error:', err);
            throw err;
        }
    }

    /**
     * Capture a region of the canvas as screenshot
     * @param {Object} bounds - { x, y, width, height } in world coordinates
     * @returns {string|null} Base64 PNG data URL
     */
    function captureRegionAsImage(bounds) {
        if (!bounds) {
            console.log('No bounds provided');
            return null;
        }

        // Get the main canvas (where everything is rendered)
        const mainCanvas = document.getElementById('drawingCanvas');
        if (!mainCanvas) {
            console.warn('Main canvas not found (drawingCanvas)');
            return null;
        }

        // Get current zoom and pan from window (exposed by 01_core.js)
        const currentZoom = typeof zoom !== 'undefined' ? zoom : 1;
        const currentPanX = typeof panX !== 'undefined' ? panX : 0;
        const currentPanY = typeof panY !== 'undefined' ? panY : 0;

        // Get device pixel ratio (canvas uses high-DPI rendering)
        const dpr = window.devicePixelRatio || 1;

        // Add padding to bounds (in world coordinates)
        const padding = 15;
        const captureX = bounds.x - padding;
        const captureY = bounds.y - padding;
        const captureWidth = bounds.width + padding * 2;
        const captureHeight = bounds.height + padding * 2;

        // Convert world coordinates to canvas buffer coordinates
        // The canvas uses: ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr)
        // So buffer position = (worldPos * zoom + pan) * dpr
        const bufferX = (captureX * currentZoom + currentPanX) * dpr;
        const bufferY = (captureY * currentZoom + currentPanY) * dpr;
        const bufferWidth = captureWidth * currentZoom * dpr;
        const bufferHeight = captureHeight * currentZoom * dpr;

        // Create output canvas at a good resolution
        const outputCanvas = document.createElement('canvas');
        const outputScale = 2; // 2x resolution for clarity
        outputCanvas.width = captureWidth * outputScale;
        outputCanvas.height = captureHeight * outputScale;
        const outputCtx = outputCanvas.getContext('2d');

        // Fill with white background first
        outputCtx.fillStyle = '#ffffff';
        outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

        // Draw the region from the main canvas buffer
        try {
            outputCtx.drawImage(
                mainCanvas,
                bufferX, bufferY, bufferWidth, bufferHeight,  // Source region (in buffer pixels)
                0, 0, outputCanvas.width, outputCanvas.height  // Destination (scaled up)
            );

            return outputCanvas.toDataURL('image/png');
        } catch (err) {
            console.error('AI Helper: Failed to capture screenshot:', err);
            return null;
        }
    }

    /**
     * Capture lasso region as screenshot (copies directly from the rendered canvas)
     * This captures exactly what's visible on screen - background, images, strokes, text, etc.
     */
    function captureLassoSelectionAsImage() {
        // Check if lasso path bounds are available
        if (typeof getLassoPathBounds !== 'function') {
            console.warn('getLassoPathBounds not available');
            return null;
        }

        const bounds = getLassoPathBounds();
        return captureRegionAsImage(bounds);
    }

    /**
     * Capture active handwritten text field as image
     */
    function captureTextFieldAsImage() {
        if (typeof HandwrittenTextField === 'undefined' || !HandwrittenTextField.activeField) {
            return null;
        }

        const field = HandwrittenTextField.activeField;
        if (!field || !field.text) return null;

        // Get the field bounds
        const settings = HandwrittenTextField.getSettings();
        const fontSize = field.fontSize || settings.fontSize;

        // Simple bounds estimation
        const charWidth = fontSize * 0.75;
        const lineHeight = fontSize * settings.lineHeight;
        const lines = field.text.split('\n');
        const maxLineLength = Math.max(...lines.map(l => l.length));

        const width = Math.max(maxLineLength * charWidth + 40, 200);
        const height = lines.length * lineHeight + 40;

        // Create temp canvas and render the text field
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // White background
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, width, height);

        // Create a temporary field at origin for rendering
        const tempField = { ...field, x: 20, y: 20 };

        // Try to use the draw function if available
        if (typeof HandwrittenTextField.draw === 'function') {
            // We need to temporarily modify the field position
            const originalX = field.x;
            const originalY = field.y;
            field.x = 20;
            field.y = 20;

            HandwrittenTextField.draw(tempCtx, false);

            field.x = originalX;
            field.y = originalY;
        }

        return tempCanvas.toDataURL('image/png');
    }

    /**
     * Get text content from active text field
     */
    function getActiveTextContent() {
        // Check handwritten text field
        if (typeof HandwrittenTextField !== 'undefined' && HandwrittenTextField.activeField) {
            return HandwrittenTextField.activeField.text || '';
        }

        // Check simple text field
        if (typeof SimpleTextField !== 'undefined' && SimpleTextField.activeField) {
            return SimpleTextField.activeField.text || '';
        }

        return '';
    }

    /**
     * Capture current page images
     */
    function getCurrentPageImages() {
        const images = [];

        if (typeof pageImages !== 'undefined' && pageImages) {
            for (const img of pageImages) {
                if (img.element && img.element.src) {
                    // Create a canvas to get the image data
                    const canvas = document.createElement('canvas');
                    canvas.width = img.element.width || img.width || 200;
                    canvas.height = img.element.height || img.height || 200;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img.element, 0, 0, canvas.width, canvas.height);
                    images.push(canvas.toDataURL('image/png'));
                }
            }
        }

        return images;
    }

    /**
     * Convert LaTeX/Markdown formatting to clean readable plain text for text fields
     */
    function stripLatexForTextField(text) {
        if (!text) return '';
        let t = text;

        // Remove $$ block delimiters and $ inline delimiters
        t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => convertLatexToPlain(inner.trim()));
        t = t.replace(/\$([\s\S]*?)\$/g, (_, inner) => convertLatexToPlain(inner.trim()));

        // Remove markdown bold/italic
        t = t.replace(/\*\*\*(.*?)\*\*\*/g, '$1');
        t = t.replace(/\*\*(.*?)\*\*/g, '$1');
        t = t.replace(/\*(.*?)\*/g, '$1');

        // Remove markdown headers
        t = t.replace(/^#{1,6}\s+/gm, '');

        // Clean up boxed results: \boxed{...}
        t = t.replace(/\\boxed\{([^}]*)\}/g, '$1');

        // Clean up multiple blank lines
        t = t.replace(/\n{3,}/g, '\n\n');

        return t.trim();
    }

    /**
     * Convert a LaTeX expression to readable plain text
     */
    function convertLatexToPlain(latex) {
        let t = latex;

        // \boxed{...}
        t = t.replace(/\\boxed\{([^}]*)\}/g, '$1');

        // \text{...} and \textbf{...} etc
        t = t.replace(/\\text(?:bf|it|rm|sf)?\{([^}]*)\}/g, '$1');

        // \frac{a}{b} → a/b
        // Handle nested fracs by running multiple passes
        for (let i = 0; i < 5; i++) {
            t = t.replace(/\\(?:tfrac|dfrac|frac)\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
        }

        // \sqrt{...} → √(...)
        t = t.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');

        // \mid → |
        t = t.replace(/\\mid/g, '|');

        // \left, \right, \big, etc. — remove
        t = t.replace(/\\(?:left|right|big|Big|bigg|Bigg)[\s]?/g, '');

        // Common symbols
        t = t.replace(/\\cdot/g, '·');
        t = t.replace(/\\times/g, '×');
        t = t.replace(/\\div/g, '÷');
        t = t.replace(/\\pm/g, '±');
        t = t.replace(/\\mp/g, '∓');
        t = t.replace(/\\leq/g, '≤');
        t = t.replace(/\\geq/g, '≥');
        t = t.replace(/\\neq/g, '≠');
        t = t.replace(/\\approx/g, '≈');
        t = t.replace(/\\infty/g, '∞');
        t = t.replace(/\\pi/g, 'π');
        t = t.replace(/\\alpha/g, 'α');
        t = t.replace(/\\beta/g, 'β');
        t = t.replace(/\\gamma/g, 'γ');
        t = t.replace(/\\delta/g, 'δ');
        t = t.replace(/\\epsilon/g, 'ε');
        t = t.replace(/\\theta/g, 'θ');
        t = t.replace(/\\lambda/g, 'λ');
        t = t.replace(/\\mu/g, 'μ');
        t = t.replace(/\\sigma/g, 'σ');
        t = t.replace(/\\omega/g, 'ω');
        t = t.replace(/\\to/g, '→');
        t = t.replace(/\\rightarrow/g, '→');
        t = t.replace(/\\leftarrow/g, '←');
        t = t.replace(/\\Rightarrow/g, '⇒');
        t = t.replace(/\\Leftarrow/g, '⇐');

        // Superscript: x^{2} → x², x^2 → x²
        const superscriptMap = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','n':'ⁿ','i':'ⁱ'};
        t = t.replace(/\^{([^}]*)}/g, (_, exp) => {
            return exp.split('').map(c => superscriptMap[c] || '^' + c).join('');
        });
        t = t.replace(/\^(\d)/g, (_, d) => superscriptMap[d] || '^' + d);

        // Subscript: x_{1} → x₁, x_1 → x₁
        const subscriptMap = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','a':'ₐ','e':'ₑ','i':'ᵢ','o':'ₒ','n':'ₙ'};
        t = t.replace(/_{([^}]*)}/g, (_, sub) => {
            return sub.split('').map(c => subscriptMap[c] || '_' + c).join('');
        });
        t = t.replace(/_(\d)/g, (_, d) => subscriptMap[d] || '_' + d);

        // Remove remaining backslash commands (e.g. \quad, \,)
        t = t.replace(/\\[a-zA-Z]+/g, ' ');
        t = t.replace(/\\[,;:!]/g, ' ');

        // Clean up braces
        t = t.replace(/[{}]/g, '');

        // Clean up extra spaces
        t = t.replace(/\s{2,}/g, ' ');

        return t.trim();
    }

    /**
     * Insert AI response as handwritten text
     */
    async function insertResponse(response, x, y) {
        if (!response) return;

        // Convert LaTeX to readable plain text for text fields
        const cleanText = stripLatexForTextField(response);

        // Get position - either provided or calculate from active field
        let insertX = x;
        let insertY = y;

        if (typeof insertX === 'undefined') {
            if (typeof HandwrittenTextField !== 'undefined' && HandwrittenTextField.activeField) {
                const field = HandwrittenTextField.activeField;
                const settings = HandwrittenTextField.getSettings();
                const lineHeight = (field.fontSize || settings.fontSize) * settings.lineHeight;
                insertX = field.x;
                insertY = field.y + lineHeight * (field.text.split('\n').length + 1);
            } else {
                // Default position
                insertX = 100;
                insertY = 100;
            }
        }

        // Create new text field with the response
        if (typeof HandwrittenTextField !== 'undefined') {
            HandwrittenTextField.deselect();
            const newField = HandwrittenTextField.createTextField(insertX, insertY);
            if (newField) {
                // Type out the response
                for (const char of cleanText) {
                    await new Promise(resolve => setTimeout(resolve, 5)); // Small delay for animation
                    newField.text += char;
                    newField.cursorPos = newField.text.length;
                }
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof triggerAutoSave === 'function') triggerAutoSave();
            }
        }
    }

    /**
     * Append response to the active text field
     */
    function appendToActiveField(response) {
        if (!response) return false;

        // Convert LaTeX to readable plain text for text fields
        const cleanText = stripLatexForTextField(response);

        if (typeof HandwrittenTextField !== 'undefined' && HandwrittenTextField.activeField) {
            const field = HandwrittenTextField.activeField;
            // Add response at cursor position or end
            const before = field.text.substring(0, field.cursorPos);
            const after = field.text.substring(field.cursorPos);
            field.text = before + cleanText + after;
            field.cursorPos = before.length + cleanText.length;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return true;
        }

        if (typeof SimpleTextField !== 'undefined' && SimpleTextField.activeField) {
            const field = SimpleTextField.activeField;
            field.text = (field.text || '') + cleanText;
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            return true;
        }

        return false;
    }

    /**
     * Show response in a toast/modal
     */
    const assistantIcons={
        close:'<path d="m6 6 12 12M18 6 6 18"/>',
        copy:'<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
        insert:'<path d="M12 5v14M5 12h14"/>',
        append:'<path d="M4 5h16M4 10h11M4 15h6M17 12v8M13 16h8"/>',
        ask:'<path d="m5 12 14-7-4 14-3-6-7-1Zm7 1 7-8"/>'
    };
    const assistantIcon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+assistantIcons[name]+'</svg>';
    function hideResponseModal(){
        const modal=document.getElementById('ai-response-modal');if(!modal)return;
        modal.classList.remove('visible');window.DialogFocus?.deactivate(modal);
    }
    async function showResponseModal(response,mode,hasActiveField=false){
        let modal=document.getElementById('ai-response-modal');
        if(!modal){
            modal=document.createElement('div');modal.id='ai-response-modal';
            modal.innerHTML=[
                '<div class="ai-modal-overlay"></div>',
                '<section class="ai-modal-content bn-sheet" role="dialog" aria-modal="true" aria-labelledby="aiResponseHeading" aria-describedby="aiResponseSubtitle">',
                '<header class="bn-sheet-header ai-modal-header"><div><h2 id="aiResponseHeading" class="ai-modal-title">Assistant</h2><p id="aiResponseSubtitle">An answer you can keep with your notes.</p></div>',
                '<button type="button" class="bn-icon-button ai-modal-close" aria-label="Close assistant">'+assistantIcon('close')+'</button></header>',
                '<div class="ai-modal-body bn-sheet-body" tabindex="0"></div>',
                '<footer class="ai-modal-actions bn-sheet-footer"><button type="button" class="bn-button ai-modal-copy">'+assistantIcon('copy')+'<span>Copy</span></button>',
                '<button type="button" class="bn-button ai-modal-append" hidden>'+assistantIcon('append')+'<span>Append to text</span></button>',
                '<button type="button" class="bn-button bn-button-primary ai-modal-insert">'+assistantIcon('insert')+'<span>Insert as handwriting</span></button></footer></section>'
            ].join('');document.body.append(modal);
            modal.querySelector('.ai-modal-overlay').onclick=hideResponseModal;
            modal.querySelector('.ai-modal-close').onclick=hideResponseModal;
            modal.querySelector('.ai-modal-copy').onclick=async()=>{
                try{await navigator.clipboard.writeText(modal._response||'');showToast('Answer copied','success');}
                catch{showToast('Could not access the clipboard. Select the answer to copy it.','error');}
            };
            modal.querySelector('.ai-modal-insert').onclick=async()=>{const text=modal._response;hideResponseModal();await insertResponse(text);};
            modal.querySelector('.ai-modal-append').onclick=()=>{if(appendToActiveField(modal._response)){hideResponseModal();showToast('Answer added','success');}else showToast('Select a text field first','info');};
            modal.addEventListener('keydown',e=>{
                if(e.key==='Enter'&&!e.target.closest('button,a,input,select,textarea')&&!e.shiftKey){
                    e.preventDefault();const append=modal.querySelector('.ai-modal-append');
                    (append.hidden?modal.querySelector('.ai-modal-insert'):append).click();
                }
            });
        }
        modal._response=response;modal.querySelector('.ai-modal-body').innerHTML=renderMarkdownAndLatex(response);
        modal.querySelector('#aiResponseSubtitle').textContent=mode==='quick'?'Just the answer. Ready for your notes.':'The explanation, with room to explore.';
        modal.querySelector('.ai-modal-append').hidden=!(HandwrittenTextField?.activeField||SimpleTextField?.activeField);
        modal.classList.add('visible');
        window.DialogFocus?.activate(modal,{close:hideResponseModal,initialFocus:'.ai-modal-body'});
        // Paint immediately; a slow math CDN never holds the sheet offscreen.
        if((response.includes('$')||response.includes('\\[')||response.includes('\\('))&&typeof katex==='undefined')loadKaTeX().then(ok=>{
            if(ok&&modal.classList.contains('visible')&&modal._response===response){
                const body=modal.querySelector('.ai-modal-body'),scroll=body.scrollTop;
                body.innerHTML=renderMarkdownAndLatex(response);body.scrollTop=scroll;
            }
        });
    }

    /**
     * Main handler for AI shortcuts
     * @param {string} mode - 'quick' or 'general'
     * @param {string} extraContext - Optional extra context from prompt input
     */
    let requestBusy=false;
    async function handleAIShortcut(mode, extraContext = '', model = 'gpt-6-luna') {
        if(requestBusy){showToast('The assistant is already answering.','info');return;}
        requestBusy=true;
        // Show loading
        if (typeof showToast === 'function') {
            showToast('AI antwortet...', 'info');
        }

        try {
            // Collect content
            let textContent = getActiveTextContent();
            let images = [];

            // Debug logging
            console.log('AI Helper: Checking for lasso selection...');
            console.log('  - getAllLassoSelections available:', typeof getAllLassoSelections === 'function');
            console.log('  - getLassoSelectionCount available:', typeof getLassoSelectionCount === 'function');

            // Check for multi-lasso selections first
            const hasMultiSelections = typeof getAllLassoSelections === 'function' &&
                                       typeof getLassoSelectionCount === 'function' &&
                                       getLassoSelectionCount() > 0;

            console.log('  - hasMultiSelections:', hasMultiSelections, 'count:',
                       typeof getLassoSelectionCount === 'function' ? getLassoSelectionCount() : 0);

            if (hasMultiSelections) {
                // Capture ALL lasso selections as separate images
                const selections = getAllLassoSelections();
                console.log('  - Capturing', selections.length, 'lasso selections...');

                for (let i = 0; i < selections.length; i++) {
                    const sel = selections[i];
                    const lassoImage = captureRegionAsImage(sel.bounds);
                    if (lassoImage) {
                        images.push(lassoImage);
                        console.log(`  - Selection ${i + 1} captured: ${lassoImage.length} bytes`);
                    }
                }

                if (images.length > 0 && !textContent) {
                    if (images.length === 1) {
                        textContent = 'Beantworte diese Frage / löse diese Aufgabe:';
                    } else {
                        textContent = `Hier sind ${images.length} Bilder. Beantworte die Fragen / löse die Aufgaben:`;
                    }
                }

                // Clear multi-selections after capturing
                if (typeof clearMultiLassoSelections === 'function') {
                    clearMultiLassoSelections();
                }
            }

            // If no lasso, check for active text field
            if (images.length === 0 && !textContent) {
                // Maybe capture the text field as image if it has handwritten content
                const textFieldImage = captureTextFieldAsImage();
                if (textFieldImage) {
                    images.push(textFieldImage);
                    textContent = 'Beantworte diese Frage / löse diese Aufgabe:';
                }
            }

            // Append extra context if provided
            if (extraContext && extraContext.trim()) {
                textContent = (textContent || '') + '\n\nZusätzlicher Kontext: ' + extraContext.trim();
            }

            console.log('AI Helper: Final state - textContent:', !!textContent, 'images:', images.length);

            // If still no content, show error
            if (!textContent && images.length === 0) {
                if (typeof showToast === 'function') {
                    showToast('Kein Text oder Auswahl gefunden', 'error');
                }
                return;
            }

            // Show loading with preview of captured images
            showLoadingWithPreview(images, mode);

            // Send to AI
            const response = await sendToAI(textContent, mode, images, model);

            // Hide loading preview
            hideLoadingPreview();

            if (response) {
                await showResponseModal(response, mode);
            } else {
                if (typeof showToast === 'function') {
                    showToast('Keine Antwort erhalten', 'error');
                }
            }
        } catch (err) {
            console.error('AI Helper error:', err);
            hideLoadingPreview();
            if (typeof showToast === 'function') {
                showToast(`Fehler: ${err.message}`, 'error');
            }
        } finally {
            requestBusy=false;
        }
    }

    /**
     * Show loading indicator with preview of captured image(s)
     * @param {string|string[]} imageData - Single image or array of images
     * @param {string} mode - 'quick' or 'general'
     */
    function showLoadingWithPreview(imageData,mode){
        const images=Array.isArray(imageData)?imageData:(imageData?[imageData]:[]);
        let preview=document.getElementById('ai-loading-preview');
        if(!preview){
            preview=document.createElement('aside');preview.id='ai-loading-preview';preview.setAttribute('role','status');preview.setAttribute('aria-live','polite');
            preview.innerHTML='<div class="ai-preview-content"><div class="ai-preview-header"><div><strong class="ai-preview-title">Assistant is thinking</strong><small class="ai-preview-mode"></small></div><div class="ai-preview-spinner" aria-hidden="true"></div></div><div class="ai-preview-images-container"></div></div>';
            document.body.append(preview);
        }
        const container=preview.querySelector('.ai-preview-images-container');container.replaceChildren();
        images.forEach((data,index)=>{
            const wrapper=document.createElement('div');wrapper.className='ai-preview-image-wrapper';
            const image=document.createElement('img');image.className='ai-preview-image';image.src=data;image.alt='Selected notes '+(index+1);wrapper.append(image);
            if(images.length>1){const badge=document.createElement('span');badge.className='ai-preview-badge';badge.textContent=index+1;wrapper.append(badge);}
            container.append(wrapper);
        });
        preview.querySelector('.ai-preview-mode').textContent=(mode==='quick'?'Just the answer':'Detailed explanation')+(images.length?' · '+images.length+' selection'+(images.length===1?'':'s'):'');
        preview.hidden=false;
    }

    /**
     * Hide loading preview
     */
    function hideLoadingPreview() {
        const preview = document.getElementById('ai-loading-preview');
        if (preview) {
            preview.hidden = true;
            preview.querySelector('.ai-preview-images-container').replaceChildren();
        }
    }

    /**
     * Show prompt input dialog for adding extra context
     */
    function hidePromptDialog(){
        const dialog=document.getElementById('ai-prompt-dialog');if(!dialog)return;
        dialog.classList.remove('visible');window.DialogFocus?.deactivate(dialog);
    }
    function showPromptInput(){
        let dialog=document.getElementById('ai-prompt-dialog');
        if(!dialog){
            dialog=document.createElement('div');dialog.id='ai-prompt-dialog';
            dialog.innerHTML=[
                '<div class="ai-prompt-overlay"></div>',
                '<form class="ai-prompt-content bn-sheet" role="dialog" aria-modal="true" aria-labelledby="aiPromptHeading" aria-describedby="aiPromptSubtitle">',
                '<header class="bn-sheet-header"><div><h2 id="aiPromptHeading">Assistant</h2><p id="aiPromptSubtitle">Ask about your selected ink or add a question.</p></div>',
                '<button type="button" class="bn-icon-button ai-prompt-close" aria-label="Close assistant">'+assistantIcon('close')+'</button></header>',
                '<div class="bn-sheet-body"><label class="bn-field-label" for="aiPromptInput">Your question or extra context</label>',
                '<textarea id="aiPromptInput" class="ai-prompt-input bn-field" rows="3" placeholder="Explain this step, check my answer, or ask something…"></textarea>',
                '<div class="ai-prompt-options"><div><label class="bn-field-label" for="aiModeSelect">Answer style</label>',
                '<select id="aiModeSelect" class="ai-mode-select bn-field"><option value="quick">Just the answer</option><option value="general">Detailed explanation</option></select></div>',
                '<div><label class="bn-field-label" for="aiModelSelect">Model</label><select id="aiModelSelect" class="ai-model-select bn-field">',
                '<optgroup label="Fast"><option value="gpt-6-luna">GPT-6 Luna</option><option value="gemini-3.7-flash">Gemini 3.7 Flash</option><option value="deepseek-v3.2">DeepSeek V3.2</option><option value="gemini-2.5-flash">Gemini 2.5 Flash</option><option value="gpt-4.1-nano">GPT-4.1 Nano</option><option value="gpt-4.1-mini">GPT-4.1 Mini</option><option value="gpt-4o-mini">GPT-4o Mini</option></optgroup>',
                '<optgroup label="Balanced"><option value="gpt-4o">GPT-4o</option><option value="gpt-4.1">GPT-4.1</option><option value="claude-sonnet-4-20250514">Claude Sonnet 4</option><option value="gemini-2.5-pro">Gemini 2.5 Pro</option><option value="kimi-k2.5">Kimi K2.5</option></optgroup>',
                '<optgroup label="Advanced"><option value="gpt-6-sol">GPT-6 Sol</option><option value="o4-mini">o4-mini</option><option value="o3">o3</option><option value="gpt-5">GPT-5</option><option value="claude-opus-4-6">Claude Opus 4.6</option><option value="claude-sonnet-4-5">Claude Sonnet 4.5</option><option value="deepseek-r1">DeepSeek R1</option></optgroup></select></div></div></div>',
                '<footer class="bn-sheet-footer"><span class="bn-key-hint">Enter to ask · Shift+Enter for a new line</span><button type="submit" class="bn-button bn-button-primary">'+assistantIcon('ask')+'<span>Ask assistant</span></button></footer></form>'
            ].join('');document.body.append(dialog);
            dialog.querySelector('.ai-prompt-overlay').onclick=hidePromptDialog;dialog.querySelector('.ai-prompt-close').onclick=hidePromptDialog;
            dialog.querySelector('form').onsubmit=e=>{
                e.preventDefault();const context=dialog.querySelector('.ai-prompt-input').value.trim(),model=dialog.querySelector('.ai-model-select').value,mode=dialog.querySelector('.ai-mode-select').value;
                hidePromptDialog();handleAIShortcut(mode,context,model);
            };
            dialog.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();dialog.querySelector('form').requestSubmit();}};
        }
        dialog.classList.add('visible');
        window.DialogFocus?.activate(dialog,{close:hidePromptDialog,initialFocus:'.ai-prompt-input'});
    }

    /**
     * Initialize keyboard shortcuts
     */
    function initShortcuts() {
        console.log('AI Helper: Initializing keyboard shortcuts');

        // The editor needs no math network requests until an answer uses math.

        document.addEventListener('keydown', (e) => {
            // Ctrl + Alt + R = Restart server
            if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
                console.log('AI Helper: Ctrl+Alt+R detected, restarting server...');
                e.preventDefault();
                e.stopPropagation();
                restartServer();
                return;
            }

            // Ctrl + Enter = Quick mode (short answers for math AND questions)
            if (e.ctrlKey && !e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                handleAIShortcut('quick', '', 'gpt-6-luna');
                return;
            }

            // Ctrl + Shift + Enter = Show prompt input for additional context
            if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                showPromptInput();
                return;
            }
        });

        console.log('AI Helper: Shortcuts ready - Ctrl+Alt+R to restart, Ctrl+Enter for AI');
    }

    /**
     * Restart the Flask server
     */
    async function restartServer() {
        if (typeof showToast === 'function') {
            showToast('Server wird neu gestartet...', 'info');
        }

        try {
            const response = await fetch('/api/server/restart', { method: 'POST' });
            if (response.ok) {
                // Wait a moment then reload page
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            }
        } catch (err) {
            // Server is restarting, this is expected
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        }
    }

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShortcuts);
    } else {
        initShortcuts();
    }

    return {
        showPrompt: showPromptInput,
        showResponse: showResponseModal,
        closePrompt: hidePromptDialog,
        closeResponse: hideResponseModal,
        sendToAI,
        handleAIShortcut,
        captureLassoSelectionAsImage,
        captureTextFieldAsImage,
        getActiveTextContent,
        insertResponse
    };
})();

window.AIHelper = AIHelper;
