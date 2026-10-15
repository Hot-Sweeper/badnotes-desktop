// ============================================================
// Gravity Scene — Constants & Shared State
// ============================================================
(function () {
    'use strict';

    const GS = window.GS = window.GS || {};

    // Physics
    GS.G = 60;
    GS.MAX_BODIES = 100;
    GS.MERGE_FACTOR = 0.45;
    GS.SHATTER_SPEED = 540;
    GS.CRUSH_MOON_SPEED = 360;
    GS.CRUSH_PLANET_SPEED = 400;
    GS.GROW_RATE = 10;

    // Mass thresholds
    GS.ASTEROID_MAX = 50;
    GS.MOON_MAX = 250;
    GS.PLANET_MAX = 1000;
    GS.STAR_MAX = 2500;

    // Rocket limits
    GS.MAX_ROCKETS = 60;
    GS.ROCKET_TRAIL_LEN = 10;

    // Color palettes per body type (expanded)
    GS.ASTEROID_COLORS = [
        { h: 30, s: 10, l: 45 }, { h: 20, s: 8, l: 40 }, { h: 40, s: 12, l: 50 },
        { h: 10, s: 15, l: 35 }, { h: 50, s: 8, l: 42 }, { h: 0, s: 6, l: 55 },
    ];
    GS.MOON_COLORS = [
        { h: 40, s: 15, l: 70 }, { h: 200, s: 10, l: 65 }, { h: 0, s: 5, l: 75 },
        { h: 30, s: 20, l: 60 }, { h: 220, s: 12, l: 72 }, { h: 300, s: 8, l: 68 },
    ];
    GS.PLANET_COLORS = [
        { h: 20, s: 75, l: 55 }, { h: 200, s: 60, l: 55 }, { h: 45, s: 70, l: 60 },
        { h: 160, s: 50, l: 50 }, { h: 280, s: 45, l: 55 }, { h: 340, s: 60, l: 60 },
        { h: 90, s: 55, l: 48 }, { h: 30, s: 80, l: 50 }, { h: 180, s: 65, l: 52 },
        { h: 260, s: 55, l: 58 }, { h: 10, s: 70, l: 45 }, { h: 120, s: 60, l: 55 },
    ];
    GS.STAR_COLORS = [
        { h: 45, s: 95, l: 60 }, { h: 30, s: 90, l: 55 }, { h: 55, s: 85, l: 65 },
        { h: 15, s: 80, l: 50 }, { h: 200, s: 70, l: 75 }, { h: 350, s: 85, l: 55 },
    ];

    // Faction definitions — 12 diverse species
    GS.FACTIONS = [
        { id: 0,  name: 'Solari',     color: '#FF4444', hue: 0,   trait: 'aggressive', species: 'Flame Wraiths' },
        { id: 1,  name: 'Aquarii',    color: '#4488FF', hue: 220, trait: 'defensive',  species: 'Deep Tide' },
        { id: 2,  name: 'Verdani',    color: '#44FF66', hue: 135, trait: 'growth',     species: 'Bloom Folk' },
        { id: 3,  name: 'Aureon',     color: '#FFAA22', hue: 38,  trait: 'traders',    species: 'Golden Merchants' },
        { id: 4,  name: 'Nexari',     color: '#CC44FF', hue: 280, trait: 'robots',     species: 'Synthminds' },
        { id: 5,  name: 'Glacium',    color: '#44FFEE', hue: 175, trait: 'miners',     species: 'Frost Borers' },
        { id: 6,  name: 'Terrans',    color: '#6699FF', hue: 210, trait: 'balanced',   species: 'Humans' },
        { id: 7,  name: 'Kha\'Zul',   color: '#FF6622', hue: 18,  trait: 'aggressive', species: 'Insectoids' },
        { id: 8,  name: 'Luminari',   color: '#FFEE55', hue: 55,  trait: 'growth',     species: 'Light Weavers' },
        { id: 9,  name: 'Obsidia',    color: '#8844AA', hue: 270, trait: 'defensive',  species: 'Shadow Dwellers' },
        { id: 10, name: 'Ferrox',     color: '#CC6633', hue: 25,  trait: 'miners',     species: 'Iron Golems' },
        { id: 11, name: 'Cryonix',    color: '#AADDFF', hue: 200, trait: 'traders',    species: 'Crystal Beings' },
    ];

    // Planet resource tints (for sun-type determination and visuals)
    GS.RESOURCE_TINTS = {
        iron:        { h: 20,  s: 70, l: 45, glow: '#FF8844', sunType: 'red_giant' },
        crystals:    { h: 220, s: 80, l: 60, glow: '#4488FF', sunType: 'blue_star' },
        uranium:     { h: 120, s: 90, l: 50, glow: '#44FF66', sunType: 'radioactive' },
        helium:      { h: 280, s: 60, l: 55, glow: '#CC66FF', sunType: 'purple_star' },
        organics:    { h: 80,  s: 65, l: 50, glow: '#AADD44', sunType: 'golden_star' },
        dark_matter: { h: 270, s: 30, l: 20, glow: '#442266', sunType: 'dark_star' },
        plasma:      { h: 35,  s: 95, l: 65, glow: '#FFAA33', sunType: 'plasma_star' },
        toxins:      { h: 95,  s: 80, l: 40, glow: '#88CC22', sunType: 'toxic_star' },
        ice:         { h: 195, s: 40, l: 80, glow: '#BBDDFF', sunType: 'white_dwarf' },
        antimatter:  { h: 310, s: 90, l: 60, glow: '#FF44DD', sunType: 'cosmic_star' },
    };

    // Sun type visual configs (created when planets collide)
    GS.SUN_TYPES = {
        yellow:       { h: 45,  s: 95, l: 60, glowColor: 'rgba(255,220,80,',  name: 'Yellow Star' },
        red_giant:    { h: 10,  s: 85, l: 50, glowColor: 'rgba(255,80,30,',   name: 'Red Giant' },
        red_dwarf:    { h: 5,   s: 70, l: 38, glowColor: 'rgba(200,60,30,',   name: 'Red Dwarf' },
        blue_star:    { h: 210, s: 90, l: 65, glowColor: 'rgba(80,150,255,',  name: 'Blue Star' },
        radioactive:  { h: 120, s: 95, l: 55, glowColor: 'rgba(80,255,50,',   name: 'Radioactive Star' },
        purple_star:  { h: 275, s: 80, l: 55, glowColor: 'rgba(180,80,255,',  name: 'Purple Star' },
        golden_star:  { h: 38,  s: 90, l: 58, glowColor: 'rgba(255,200,50,',  name: 'Golden Star' },
        nuclear:      { h: 100, s: 95, l: 50, glowColor: 'rgba(100,255,50,',  name: 'Nuclear Star' },
        toxic_star:   { h: 90,  s: 85, l: 42, glowColor: 'rgba(140,220,30,',  name: 'Toxic Star' },
        cosmic_star:  { h: 290, s: 80, l: 65, glowColor: 'rgba(200,100,255,', name: 'Cosmic Star' },
        dark_star:    { h: 265, s: 40, l: 18, glowColor: 'rgba(60,30,100,',   name: 'Dark Star' },
        white_dwarf:  { h: 200, s: 15, l: 92, glowColor: 'rgba(230,240,255,', name: 'White Dwarf' },
        neutron_star: { h: 195, s: 95, l: 80, glowColor: 'rgba(180,220,255,', name: 'Neutron Star' },
        plasma_star:  { h: 30,  s: 100,l: 60, glowColor: 'rgba(255,180,50,',  name: 'Plasma Star' },
        ice_star:     { h: 200, s: 30, l: 85, glowColor: 'rgba(200,220,255,', name: 'Ice Star' },
    };

    // All resource types for random assignment
    GS.RESOURCE_NAMES = Object.keys(GS.RESOURCE_TINTS);
})();
