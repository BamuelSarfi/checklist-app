import React from "react";
import "./TextInput.css";

export interface TextInputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
    /** Unifies .sc1_text_input / .sc2_temp_input / .sc3_input / .sc4_input
     * into one component with a single, consistent focus treatment. */
    label?: string;
    error?: string;
}

export function TextInput({ label, error, id, className, ...rest }: TextInputProps) {
    return (
        <div className="ds-field">
            {label && (
                <label className="ds-field-label" htmlFor={id}>
                    {label}
                </label>
            )}
            <input
                id={id}
                className={["ds-text-input", className].filter(Boolean).join(" ")}
                {...rest}
            />
            {error && <div className="ds-field-error">{error}</div>}
        </div>
    );
}
