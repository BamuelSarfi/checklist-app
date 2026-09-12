import React from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "icon";

export interface ButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
    /** Visual style. Collapses the ~14 independently-declared button
     * families found in style.css (bottom nav, add-record, back button,
     * logout, modal actions, etc.) into four variants. */
    variant?: ButtonVariant;
    /** Stretches to 100% width, matching #add_record_button / #login_button. */
    fullWidth?: boolean;
    /** Shows the spinner used by script.js's setButtonLoading() and disables the button. */
    loading?: boolean;
    type?: "button" | "submit";
    icon?: React.ReactNode;
}

export function Button({
    variant = "secondary",
    fullWidth = false,
    loading = false,
    disabled = false,
    type = "button",
    icon,
    children,
    className,
    ...rest
}: ButtonProps) {
    const classes = [
        "ds-button",
        `ds-button--${variant}`,
        fullWidth ? "ds-button--full" : "",
        loading ? "is-loading" : "",
        className || "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <button
            type={type}
            className={classes}
            disabled={disabled || loading}
            {...rest}
        >
            {loading ? <span className="ds-btn-spinner" aria-hidden="true" /> : icon}
            {children}
        </button>
    );
}
