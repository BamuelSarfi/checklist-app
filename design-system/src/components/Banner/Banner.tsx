import React from "react";
import "./Banner.css";

export type BannerVariant = "warning" | "error" | "info";

export interface BannerProps {
    /** Unifies script.js's sync-warning banner (JS-authored inline styles
     * today) and the sc2_note/sc3_note_section informational callouts. */
    variant?: BannerVariant;
    children: React.ReactNode;
    onDismiss?: () => void;
}

export function Banner({ variant = "info", children, onDismiss }: BannerProps) {
    return (
        <div className={`ds-banner ds-banner--${variant}`} role="status">
            <div>{children}</div>
            {onDismiss && (
                <button
                    type="button"
                    className="ds-banner-dismiss"
                    aria-label="Dismiss"
                    onClick={onDismiss}
                >
                    ×
                </button>
            )}
        </div>
    );
}
