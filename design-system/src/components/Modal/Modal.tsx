import React, { useEffect, useRef } from "react";
import "./Modal.css";

export type ModalType = "success" | "error" | "info";

export interface ModalProps {
    /** The shared notification modal from script.js's showAppModal() -
     * the app-wide replacement for native alert(). */
    open: boolean;
    type?: ModalType;
    message: string;
    onOk: () => void;
    okLabel?: string;
}

export function Modal({ open, type = "info", message, onOk, okLabel = "OK" }: ModalProps) {
    const okButtonRef = useRef<HTMLButtonElement>(null);

    // Matches the original showAppModal()'s okBtn.focus() - moves focus into the
    // dialog on open so keyboard/screen-reader users land on the actionable control.
    useEffect(() => {
        if (open) {
            okButtonRef.current?.focus();
        }
    }, [open]);

    if (!open) return null;
    return (
        <div className="ds-modal-overlay">
            <div className={`ds-modal-box type-${type}`}>
                <div className="ds-modal-message">{message}</div>
                <div className="ds-modal-actions">
                    <button type="button" ref={okButtonRef} onClick={onOk}>
                        {okLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
