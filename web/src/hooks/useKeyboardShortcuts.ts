/**
 * useKeyboardShortcuts — Global keyboard shortcut handler.
 *
 * Registers document-level listeners for:
 *   - Ctrl+K / Cmd+K  → Open command palette
 *   - g then d         → Go to Dashboard (Command Center)
 *   - g then t         → Go to Targets
 *   - g then r         → Go to Results
 *   - g then l         → Go to Logs
 *   - g then c         → Go to Configuration
 *   - g then e         → Go to Exploitation
 *   - g then s         → Go to Services
 *   - g then a         → Go to AI Stream
 *   - g then o         → Go to Loot
 *   - Escape           → Close command palette
 *
 * Mount this hook once in App.tsx (or in CommandPalette).
 */

import { useEffect, useRef } from 'react';
import { useUIStore } from '@stores/uiStore';

interface UseKeyboardShortcutsOptions {
  onOpenPalette: () => void;
  onClosePalette: () => void;
  isPaletteOpen: boolean;
}

export function useKeyboardShortcuts({
  onOpenPalette,
  onClosePalette,
  isPaletteOpen,
}: UseKeyboardShortcutsOptions): void {
  const { setActiveView } = useUIStore();

  // Track whether the user has pressed 'g' and is waiting for a second key.
  // We store this in a ref to avoid stale closure issues.
  const gPressedRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;

      // Ignore shortcuts when the user is typing in an input/textarea/select
      // (except for Escape and Ctrl+K which should always work).
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // ── Ctrl+K / Cmd+K — open palette from anywhere ──────────────
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        if (isPaletteOpen) {
          onClosePalette();
        } else {
          onOpenPalette();
        }
        return;
      }

      // ── Escape — close palette ────────────────────────────────────
      if (event.key === 'Escape' && isPaletteOpen) {
        event.preventDefault();
        onClosePalette();
        gPressedRef.current = false;
        if (gTimerRef.current !== null) {
          clearTimeout(gTimerRef.current);
          gTimerRef.current = null;
        }
        return;
      }

      // Skip navigation shortcuts while palette is open or user is typing
      if (isPaletteOpen || isTyping) return;

      // ── "g" prefix navigation ─────────────────────────────────────
      if (gPressedRef.current) {
        // Clear the pending timer
        if (gTimerRef.current !== null) {
          clearTimeout(gTimerRef.current);
          gTimerRef.current = null;
        }
        gPressedRef.current = false;

        switch (event.key) {
          case 'd':
            event.preventDefault();
            setActiveView('dashboard');
            break;
          case 't':
            event.preventDefault();
            setActiveView('targets');
            break;
          case 'r':
            event.preventDefault();
            setActiveView('results');
            break;
          case 'l':
            event.preventDefault();
            setActiveView('logs');
            break;
          case 'c':
            event.preventDefault();
            setActiveView('config');
            break;
          case 'e':
            event.preventDefault();
            setActiveView('exploitation');
            break;
          case 's':
            event.preventDefault();
            setActiveView('services');
            break;
          case 'a':
            event.preventDefault();
            setActiveView('ai-stream');
            break;
          case 'o':
            event.preventDefault();
            setActiveView('loot');
            break;
          default:
            break;
        }
        return;
      }

      // Detect the leading 'g' keypress
      if (event.key === 'g' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        gPressedRef.current = true;

        // Auto-reset if no second key is pressed within 1 second
        gTimerRef.current = setTimeout(() => {
          gPressedRef.current = false;
          gTimerRef.current = null;
        }, 1000);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (gTimerRef.current !== null) {
        clearTimeout(gTimerRef.current);
      }
    };
  }, [isPaletteOpen, onOpenPalette, onClosePalette, setActiveView]);
}
