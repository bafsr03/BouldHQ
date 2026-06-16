// Default backend URL the desktop app points at. Teammates don't need to type
// this in on first launch — it's baked into the build. Anyone who wants to
// override (self-hosting, staging, dev tunnel) can still paste a custom URL
// on the sign-in screen; that overrides the default and is persisted in
// localStorage.
export const DEFAULT_BACKEND_URL = 'https://hq.bouldhq.com';

export function getBlinkoEndpoint(path: string = ''): string {
    try {
        const saved = window.localStorage.getItem('blinkoEndpoint');
        const isTauri = !!(window as any).__TAURI__;
        if (isTauri) {
            const base = (saved || DEFAULT_BACKEND_URL).replace(/"/g, '');
            try {
                return new URL(path, base).toString();
            } catch (error) {
                console.error(error);
                return new URL(path, DEFAULT_BACKEND_URL).toString();
            }
        }

        return new URL(path, window.location.origin).toString();
    } catch (error) {
        console.error(error);
        return new URL(path, window.location.origin).toString();
    }
}

// Because we now ship a default, the desktop app never has "no endpoint" —
// the sign-in page can skip its endpoint prompt and go straight to login.
export function isTauriAndEndpointUndefined(): boolean {
    return false;
}

export function saveBlinkoEndpoint(endpoint: string): void {
    if (endpoint) {
        window.localStorage.setItem('blinkoEndpoint', endpoint);
    }
}

// Returns the saved endpoint, or the default if none has been saved yet.
// The sign-in page shows this in its (now optional) override field so users
// can see what they're connected to and edit if needed.
export function getSavedEndpoint(): string {
    return window.localStorage.getItem('blinkoEndpoint') || DEFAULT_BACKEND_URL;
}
