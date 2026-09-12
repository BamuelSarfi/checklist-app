import React from "react";
import "./Textarea.css";
import "../TextInput/TextInput.css";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** Unifies .sc2_textarea / .sc3_textarea / .sc4_textarea. */
    label?: string;
    error?: string;
}

export function Textarea({ label, error, id, className, ...rest }: TextareaProps) {
    return (
        <div className="ds-field">
            {label && (
                <label className="ds-field-label" htmlFor={id}>
                    {label}
                </label>
            )}
            <textarea
                id={id}
                className={["ds-textarea", className].filter(Boolean).join(" ")}
                {...rest}
            />
            {error && <div className="ds-field-error">{error}</div>}
        </div>
    );
}
