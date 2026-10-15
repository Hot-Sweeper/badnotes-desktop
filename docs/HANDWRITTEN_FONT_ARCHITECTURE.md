# Handwritten Font System - Architecture & Design Document

## 🎯 Overview

A system that allows users to create custom handwritten fonts by drawing characters multiple times, then use those strokes to render typed text with natural handwriting appearance and smooth drawing animations.

---

## 📊 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    HANDWRITTEN FONT SYSTEM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │  FONT TRAINING   │    │   TEXT TYPING    │                  │
│  │     MODULE       │    │     MODULE       │                  │
│  └────────┬─────────┘    └────────┬─────────┘                  │
│           │                       │                             │
│           ▼                       ▼                             │
│  ┌──────────────────────────────────────────┐                  │
│  │           FONT DATA STORAGE               │                  │
│  │   (Character Strokes + Variants + Meta)   │                  │
│  └──────────────────────────────────────────┘                  │
│           │                       │                             │
│           ▼                       ▼                             │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │  STROKE RENDERER │    │ ANIMATION ENGINE │                  │
│  │   (Canvas Draw)  │    │ (Playback/Timing)│                  │
│  └──────────────────┘    └──────────────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 Data Structures

### 1. Font Profile
```javascript
// Stored in: data/fonts/{fontId}.json
{
    "id": "abc123",
    "name": "My Handwriting",
    "createdAt": "2026-01-16T...",
    "modifiedAt": "2026-01-16T...",
    "metadata": {
        "author": "User",
        "baselineOffset": 0.8,      // Where baseline sits (0-1 of char height)
        "averageCharWidth": 40,     // Computed average
        "averageCharHeight": 60,    // Computed average
        "letterSpacing": 5,         // Default spacing between chars
        "lineHeight": 1.4,          // Multiplier of char height
        "slant": 0                  // Degrees of italic slant (-15 to 15)
    },
    "characters": {
        // See Character Data below
    }
}
```

### 2. Character Data
```javascript
// Each character has multiple variants
"A": {
    "variants": [
        {
            "id": "var_001",
            "strokes": [
                {
                    "id": 1705412345678,
                    "points": [
                        { "x": 0.0, "y": 1.0, "pressure": 0.5, "time": 0 },
                        { "x": 0.2, "y": 0.6, "pressure": 0.7, "time": 12 },
                        { "x": 0.4, "y": 0.2, "pressure": 0.8, "time": 24 },
                        { "x": 0.5, "y": 0.0, "pressure": 0.6, "time": 36 }
                        // ... normalized coordinates (0-1) relative to bounding box
                    ],
                    "color": "inherit",  // Uses current text color
                    "size": 1.0          // Relative size multiplier
                },
                // Multiple strokes per letter (e.g., "A" has 3 strokes)
            ],
            "boundingBox": { "width": 0.8, "height": 1.0 },  // Aspect ratio
            "totalTime": 450  // Total drawing time in ms
        },
        // More variants for natural variation
    ],
    "preferredVariant": 0  // Default variant index
}
```

### 3. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Normalized Coordinates (0-1)** | Scale-independent, can render at any size |
| **Time per Point** | Enables accurate drawing animation playback |
| **Multiple Variants** | Natural handwriting varies - pick randomly |
| **Pressure Data** | Maintains authentic stroke thickness variation |
| **Relative Bounding Box** | Proper character proportions when scaling |

---

## 🎨 Font Training Module

### UI Components

```
┌─────────────────────────────────────────────────────────────────┐
│  FONT TRAINING INTERFACE                                   [×]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Font Name: [My Handwriting          ]    [Save] [Export]       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Character Selector                                       │   │
│  │ [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P][Q][R]  │   │
│  │ [S][T][U][V][W][X][Y][Z]                                 │   │
│  │ [a][b][c][d][e][f][g][h][i][j][k][l][m][n][o][p][q][r]  │   │
│  │ [s][t][u][v][w][x][y][z]                                 │   │
│  │ [0][1][2][3][4][5][6][7][8][9]                           │   │
│  │ [.][,][!][?][']["][;][:][/][\][-][_][(][)][+][=][@][#]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Training: "A" (Variant 3/5)                [← Prev] [Next →]   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │                        ╭───╮                            │   │
│  │                       ╱     ╲                           │   │
│  │                      ╱   A   ╲    ← Ghost guide         │   │
│  │                     ╱─────────╲                         │   │
│  │                    ╱           ╲                        │   │
│  │                                                         │   │
│  │           [Draw your "A" here - try to match]           │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Variants for "A":                                              │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                           │
│  │ A₁ │ │ A₂ │ │ A₃ │ │ +  │ │    │   [Delete Selected]       │
│  └────┘ └────┘ └────┘ └────┘ └────┘                           │
│                                                                 │
│  Progress: ████████████░░░░░░░░ 62 / 94 characters trained     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Training Flow

1. **Select Character** - User picks which character to train
2. **Draw Character** - User draws the character on canvas
3. **Normalize & Store** - System normalizes coordinates and stores
4. **Add Variants** - User draws 3-5 variants for natural variation
5. **Review & Edit** - User can preview, delete, or redraw variants
6. **Progress Track** - Show completion percentage

### Character Set (94 characters)

| Category | Characters | Count |
|----------|-----------|-------|
| Uppercase | A-Z | 26 |
| Lowercase | a-z | 26 |
| Numbers | 0-9 | 10 |
| Punctuation | . , ! ? ' " ; : | 8 |
| Symbols | / \ - _ ( ) + = @ # $ % & * | 14 |
| Space | (blank) | 1 |
| **Total** | | **85** |

---

## ✍️ Text Typing Module

### UI Components

```
┌─────────────────────────────────────────────────────────────────┐
│  HANDWRITTEN TEXT TOOL                                          │
├─────────────────────────────────────────────────────────────────┤
│  Font: [My Handwriting ▼]   Size: [24px]   Color: [■]          │
│                                                                 │
│  Animation: [●] On    Speed: [━━━━●━━━━]    [✓] Cursor Blink   │
│                                                                 │
│  Click on canvas to start typing...                             │
└─────────────────────────────────────────────────────────────────┘
```

### Typing Flow

1. **Click Position** - User clicks on canvas to start text block
2. **Text Input** - Virtual keyboard or physical keyboard input
3. **Real-time Render** - Each keystroke renders the character
4. **Animation** - Character "draws itself" stroke by stroke
5. **Cursor** - Blinking cursor shows current position
6. **Line Wrapping** - Auto-wrap at canvas edge or manual Enter

### Rendering Logic

```javascript
function renderCharacter(char, x, y, size, animate = true) {
    // 1. Get random variant for natural variation
    const variant = getRandomVariant(font, char);

    // 2. Scale strokes to target size
    const scaledStrokes = scaleStrokes(variant.strokes, size);

    // 3. Apply position offset
    const positionedStrokes = offsetStrokes(scaledStrokes, x, y);

    // 4. Either animate or draw instantly
    if (animate) {
        animateStrokes(positionedStrokes, variant.totalTime);
    } else {
        drawStrokesInstant(positionedStrokes);
    }

    // 5. Return advance width for next character
    return size * variant.boundingBox.width + font.metadata.letterSpacing;
}
```

---

## 🎬 Animation Engine

### Stroke Animation Technique

Uses **progressive point rendering** (not SVG dashoffset since we're on Canvas):

```javascript
function animateStrokes(strokes, totalTime) {
    const startTime = performance.now();

    function frame() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / totalTime, 1);

        // Clear and redraw up to current progress
        for (const stroke of strokes) {
            const pointCount = Math.floor(stroke.points.length * progress);
            drawStrokePartial(stroke, pointCount);
        }

        if (progress < 1) {
            requestAnimationFrame(frame);
        }
    }

    requestAnimationFrame(frame);
}
```

### Animation Options

| Option | Description | Default |
|--------|-------------|---------|
| `animationEnabled` | Toggle animation on/off | true |
| `animationSpeed` | Multiplier (0.5x - 3x) | 1.0x |
| `strokeByStroke` | Animate each stroke sequentially | true |
| `cursorVisible` | Show blinking cursor | true |
| `cursorBlinkRate` | Blink interval ms | 500 |

---

## 🗂️ File Structure

```
BadNotes/
├── data/
│   └── fonts/                          # Font storage
│       ├── default_cursive.json        # Pre-built example font
│       └── {user_font_id}.json         # User-created fonts
│
├── static/
│   ├── css/
│   │   └── font-trainer.css            # Training UI styles
│   │
│   └── js/
│       └── modules/
│           ├── 20_font_core.js         # Font data structures & storage
│           ├── 21_font_trainer.js      # Training UI & capture
│           ├── 22_font_renderer.js     # Text rendering engine
│           └── 23_font_animation.js    # Stroke animation
│
└── templates/
    └── index.html                       # (Add font trainer modal)
```

---

## 🔌 API Endpoints

### Font Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fonts` | List all fonts |
| GET | `/api/fonts/{id}` | Get font data |
| POST | `/api/fonts` | Create new font |
| PUT | `/api/fonts/{id}` | Update font |
| DELETE | `/api/fonts/{id}` | Delete font |

### Character Training

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/fonts/{id}/characters/{char}` | Add character variant |
| DELETE | `/api/fonts/{id}/characters/{char}/{variantId}` | Delete variant |

---

## 📋 Implementation Phases

### Phase 1: Core Foundation (Session 1)
- [ ] Font data structure and storage
- [ ] Backend API for fonts
- [ ] Basic font training UI (modal)
- [ ] Stroke capture and normalization

### Phase 2: Training Interface (Session 2)
- [ ] Complete character selector
- [ ] Variant management (add/delete/preview)
- [ ] Ghost guide overlay
- [ ] Progress tracking

### Phase 3: Text Rendering (Session 3)
- [ ] Text tool activation
- [ ] Character rendering engine
- [ ] Cursor and text positioning
- [ ] Line wrapping

### Phase 4: Animation (Session 4)
- [ ] Stroke-by-stroke animation
- [ ] Animation speed controls
- [ ] Real-time typing animation
- [ ] Polish and optimization

---

## 🎯 Key Technical Challenges

### 1. Stroke Normalization
**Problem:** Users draw at different sizes and positions.
**Solution:** After capture, normalize all coordinates to 0-1 range relative to bounding box.

```javascript
function normalizeStrokes(strokes) {
    // Find bounding box of all points
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const stroke of strokes) {
        for (const pt of stroke.points) {
            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y);
            maxY = Math.max(maxY, pt.y);
        }
    }

    const width = maxX - minX || 1;
    const height = maxY - minY || 1;

    // Normalize to 0-1 range
    return strokes.map(stroke => ({
        ...stroke,
        points: stroke.points.map(pt => ({
            x: (pt.x - minX) / width,
            y: (pt.y - minY) / height,
            pressure: pt.pressure,
            time: pt.time
        }))
    }));
}
```

### 2. Consistent Character Sizing
**Problem:** Different characters have different aspect ratios (W vs I).
**Solution:** Store aspect ratio per character, scale based on height, adjust width.

### 3. Natural Variation
**Problem:** Identical characters look robotic.
**Solution:**
- Store 3-5 variants per character
- Pick randomly when rendering
- Add subtle position jitter (±2px)
- Add subtle rotation jitter (±2°)

### 4. Performance with Many Characters
**Problem:** Long text = many strokes = slow.
**Solution:**
- Batch render static text to offscreen canvas
- Only animate newly typed characters
- Use spatial indexing for visible text only

---

## 🧪 Testing Strategy

1. **Unit Tests**
   - Stroke normalization
   - Coordinate scaling
   - Variant selection

2. **Integration Tests**
   - Font save/load
   - Character training flow
   - Text rendering

3. **Visual Tests**
   - Animation smoothness
   - Character alignment
   - Line wrapping behavior

---

## 📝 Notes for Implementation

1. **Reuse Existing Stroke Code**
   - BadNotes already has stroke capture (`03_canvas_core.js`)
   - Reuse `currentStroke` format and drawing code
   - Adapt smoothing algorithm for font strokes

2. **Integration with Canvas**
   - Text strokes become regular strokes after typing
   - Can be selected/moved with lasso tool
   - Saved as part of page data

3. **Backwards Compatibility**
   - New font module should be optional
   - Pages without handwritten text work normally
   - Font data stored separately from notebooks

---

**Document Version:** 1.0
**Created:** 2026-01-16
**Last Updated:** 2026-01-16
