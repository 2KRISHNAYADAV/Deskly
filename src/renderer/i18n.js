import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

i18n
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
        },
        lng: 'en',
        fallbackLng: 'en',
        interpolation: { escapeValue: false },
        saveMissing: false,
    });

if (typeof document !== 'undefined') {
    document.documentElement.lang = 'en';
}

export function setLanguage() {
    // English-only for Academic Edition
}

export const supportedLanguages = [
    { code: 'en', label: 'English' },
];

export function getDateLocale() {
    return 'en-US';
}

export default i18n;
