export const FIGMA_DEFAULT_COLOR_MODE = 'neo';

export const FIGMA_COLOR_MODE_OPTIONS = [
    { value: 'neo', label: 'Neo Cyan', primary: '#06b6d4', secondary: '#10b981', scheme: 'dark' },
    { value: 'violet', label: 'Violet Storm', primary: '#e879f9', secondary: '#a78bfa', scheme: 'dark' },
    { value: 'emerald', label: 'Emerald Wave', primary: '#10b981', secondary: '#0ea5e9', scheme: 'dark' },
    { value: 'sunset', label: 'Sunset Pulse', primary: '#f97316', secondary: '#ec4899', scheme: 'dark' },
    { value: 'white', label: 'Stylish White', primary: '#2563eb', secondary: '#10b981', scheme: 'light' },
    { value: 'aqua', label: 'Aqua Frost', primary: '#22d3ee', secondary: '#6366f1', scheme: 'dark' },
    { value: 'ruby', label: 'Ruby Flame', primary: '#f43f5e', secondary: '#fb7185', scheme: 'dark' },
    { value: 'midnight', label: 'Midnight Sapphire', primary: '#60a5fa', secondary: '#818cf8', scheme: 'dark' },
    { value: 'gold', label: 'Golden Ember', primary: '#f59e0b', secondary: '#f97316', scheme: 'dark' },
    { value: 'monochrome', label: 'Monochrome Steel', primary: '#cbd5e1', secondary: '#94a3b8', scheme: 'dark' },
];

export const FIGMA_COLOR_MODE_VALUES = new Set(FIGMA_COLOR_MODE_OPTIONS.map((mode) => mode.value));

