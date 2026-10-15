/**
 * TextTool - Add and edit text on canvas
 * Supports rich text formatting
 */
class TextTool extends BaseTool {
    constructor(options = {}) {
        super('text', {
            color: '#ffffff',
            fontSize: 16,
            fontFamily: 'Inter',
            fontWeight: 'normal',
            fontStyle: 'normal',
            textAlign: 'left',
            lineHeight: 1.5,
            ...options,
        });

        // Text input element
        this.inputElement = null;
        this.currentTextBox = null;
        this.isEditing = false;

        // Available fonts
        this.fonts = [
            'Inter',
            'Arial',
            'Helvetica',
            'Times New Roman',
            'Georgia',
            'Courier New',
            'Monaco',
            'Comic Sans MS',
        ];
    }

    /**
     * Handle pointer down - create or edit text
     */
    onPointerDown(pointerData) {
        if (!this.isActive) return;

        const x = pointerData.x;
        const y = pointerData.y;

        // Check if clicking on existing text
        const existingText = this.findTextAt(x, y);

        if (existingText) {
            this.editText(existingText);
        } else if (!this.isEditing) {
            this.createNewText(x, y);
        } else {
            this.finishEditing();
        }
    }

    onPointerMove() {
        // Not used for text
    }

    onPointerUp() {
        // Not used for text
    }

    /**
     * Create new text box
     */
    createNewText(x, y) {
        this.currentTextBox = {
            id: `text_${Date.now()}`,
            type: 'text',
            x: x,
            y: y,
            text: '',
            color: this.settings.color,
            fontSize: this.settings.fontSize,
            fontFamily: this.settings.fontFamily,
            fontWeight: this.settings.fontWeight,
            fontStyle: this.settings.fontStyle,
            textAlign: this.settings.textAlign,
            lineHeight: this.settings.lineHeight,
            width: 200,
            height: 'auto',
        };

        this.showInputElement(x, y);
    }

    /**
     * Edit existing text
     */
    editText(textBox) {
        this.currentTextBox = textBox;
        this.showInputElement(textBox.x, textBox.y, textBox.text);
    }

    /**
     * Show text input element
     */
    showInputElement(x, y, existingText = '') {
        this.isEditing = true;

        // Create textarea
        this.inputElement = document.createElement('textarea');
        this.inputElement.className = 'text-input-overlay';
        this.inputElement.value = existingText;

        // Apply styles
        Object.assign(this.inputElement.style, {
            position: 'absolute',
            left: `${x}px`,
            top: `${y}px`,
            minWidth: '200px',
            minHeight: '40px',
            color: this.settings.color,
            fontSize: `${this.settings.fontSize}px`,
            fontFamily: this.settings.fontFamily,
            fontWeight: this.settings.fontWeight,
            fontStyle: this.settings.fontStyle,
            textAlign: this.settings.textAlign,
            lineHeight: this.settings.lineHeight,
            background: 'rgba(0, 0, 0, 0.3)',
            border: '2px solid var(--accent-primary)',
            borderRadius: '4px',
            padding: '8px',
            resize: 'both',
            outline: 'none',
            overflow: 'auto',
            zIndex: '1000',
        });

        // Add to canvas container
        const container = document.querySelector('.canvas-wrapper');
        if (container) {
            container.appendChild(this.inputElement);
            this.inputElement.focus();
        }

        // Event listeners
        this.inputElement.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.inputElement.addEventListener('blur', () => {
            // Delay to allow for potential clicks
            setTimeout(() => this.finishEditing(), 100);
        });
        this.inputElement.addEventListener('input', this.handleInput.bind(this));
    }

    /**
     * Handle key down in text input
     */
    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.cancelEditing();
        } else if (e.key === 'Enter' && e.ctrlKey) {
            this.finishEditing();
        }

        e.stopPropagation();
    }

    /**
     * Handle input change
     */
    handleInput() {
        if (this.inputElement) {
            // Auto-resize
            this.inputElement.style.height = 'auto';
            this.inputElement.style.height = `${this.inputElement.scrollHeight}px`;
        }
    }

    /**
     * Finish editing and save text
     */
    finishEditing() {
        if (!this.isEditing || !this.inputElement) return;

        const text = this.inputElement.value.trim();

        if (text) {
            this.currentTextBox.text = text;
            this.currentTextBox.width = this.inputElement.offsetWidth;
            this.currentTextBox.height = this.inputElement.offsetHeight;

            // Add or update text on canvas
            CanvasManager.addText(this.currentTextBox);
            this.emit('textCreated', this.currentTextBox);
        }

        this.cleanup();
    }

    /**
     * Cancel editing without saving
     */
    cancelEditing() {
        this.cleanup();
    }

    /**
     * Clean up input element
     */
    cleanup() {
        if (this.inputElement && this.inputElement.parentNode) {
            this.inputElement.parentNode.removeChild(this.inputElement);
        }

        this.inputElement = null;
        this.currentTextBox = null;
        this.isEditing = false;
    }

    /**
     * Find text at position
     */
    findTextAt(x, y) {
        const textElements = CanvasManager.getTextElements();

        for (const text of textElements) {
            if (x >= text.x && x <= text.x + text.width &&
                y >= text.y && y <= text.y + text.height) {
                return text;
            }
        }

        return null;
    }

    /**
     * Deactivate tool
     */
    onDeactivate() {
        if (this.isEditing) {
            this.finishEditing();
        }
    }

    /**
     * Set font family
     */
    setFontFamily(font) {
        this.settings.fontFamily = font;
        this.emit('fontFamilyChanged', font);
    }

    /**
     * Set font size
     */
    setFontSize(size) {
        this.settings.fontSize = size;
        this.emit('fontSizeChanged', size);
    }

    /**
     * Toggle bold
     */
    toggleBold() {
        this.settings.fontWeight = this.settings.fontWeight === 'bold' ? 'normal' : 'bold';
        this.emit('fontWeightChanged', this.settings.fontWeight);
    }

    /**
     * Toggle italic
     */
    toggleItalic() {
        this.settings.fontStyle = this.settings.fontStyle === 'italic' ? 'normal' : 'italic';
        this.emit('fontStyleChanged', this.settings.fontStyle);
    }

    /**
     * Set text alignment
     */
    setAlignment(align) {
        this.settings.textAlign = align;
        this.emit('textAlignChanged', align);
    }

    getCursor() {
        return 'text';
    }
}


/**
 * Render text on canvas
 */
class TextRenderer {
    /**
     * Render text element
     */
    static render(ctx, textBox) {
        ctx.save();

        ctx.fillStyle = textBox.color || '#ffffff';
        ctx.font = TextRenderer.buildFont(textBox);
        ctx.textBaseline = 'top';
        ctx.textAlign = textBox.textAlign || 'left';
        ctx.globalAlpha = textBox.opacity || 1;

        // Handle multi-line text
        const lines = textBox.text.split('\n');
        const lineHeight = textBox.fontSize * (textBox.lineHeight || 1.5);

        let y = textBox.y;
        for (const line of lines) {
            let x = textBox.x;

            // Adjust x based on alignment
            if (textBox.textAlign === 'center') {
                x = textBox.x + textBox.width / 2;
            } else if (textBox.textAlign === 'right') {
                x = textBox.x + textBox.width;
            }

            ctx.fillText(line, x, y);
            y += lineHeight;
        }

        ctx.restore();
    }

    /**
     * Build font string
     */
    static buildFont(textBox) {
        const style = textBox.fontStyle || 'normal';
        const weight = textBox.fontWeight || 'normal';
        const size = textBox.fontSize || 16;
        const family = textBox.fontFamily || 'Inter';

        return `${style} ${weight} ${size}px ${family}`;
    }

    /**
     * Measure text dimensions
     */
    static measureText(ctx, textBox) {
        ctx.font = TextRenderer.buildFont(textBox);

        const lines = textBox.text.split('\n');
        const lineHeight = textBox.fontSize * (textBox.lineHeight || 1.5);

        let maxWidth = 0;
        for (const line of lines) {
            const metrics = ctx.measureText(line);
            maxWidth = Math.max(maxWidth, metrics.width);
        }

        return {
            width: maxWidth,
            height: lines.length * lineHeight,
        };
    }
}


// Make available globally
window.TextTool = TextTool;
window.TextRenderer = TextRenderer;
