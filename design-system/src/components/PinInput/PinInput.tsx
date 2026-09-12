import React, { useRef } from "react";
import "./PinInput.css";

export interface PinInputProps {
    /** Unifies login.html's 6-box .pin_digit group into one component,
     * preserving its auto-advance / backspace / paste-splitting behavior. */
    length?: number;
    value: string;
    onChange: (value: string) => void;
    onComplete?: (value: string) => void;
    error?: string;
    autoFocus?: boolean;
    "aria-label"?: string;
}

export function PinInput({
    length = 6,
    value,
    onChange,
    onComplete,
    error,
    autoFocus,
    "aria-label": ariaLabel = "PIN entry",
}: PinInputProps) {
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const digits = Array.from({ length }, (_, i) => value[i] || "");

    const commit = (next: string) => {
        onChange(next);
        if (next.length === length && onComplete) onComplete(next);
    };

    const handleChange = (index: number, raw: string) => {
        const digit = raw.replace(/\D/g, "").slice(-1);
        const next = digits.slice();
        next[index] = digit;
        commit(next.join("").slice(0, length));
        if (digit && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
        if (!pasted) return;
        e.preventDefault();
        commit(pasted);
        const focusIndex = Math.min(pasted.length, length - 1);
        inputRefs.current[focusIndex]?.focus();
    };

    return (
        <div>
            <div className="ds-pin-group" aria-label={ariaLabel}>
                {digits.map((digit, index) => (
                    <input
                        key={index}
                        ref={(el) => {
                            inputRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={1}
                        className="ds-pin-digit"
                        value={digit}
                        aria-label={`PIN digit ${index + 1}`}
                        autoFocus={autoFocus && index === 0}
                        onChange={(e) => handleChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        onPaste={handlePaste}
                    />
                ))}
            </div>
            {error && <div className="ds-pin-error">{error}</div>}
        </div>
    );
}
