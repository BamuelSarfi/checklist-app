import React from "react";
import "./ToggleQuestion.css";

export interface ToggleQuestionProps {
    /** The yes/no custom control from sc1.html/sc5.html:
     * .button_checklist_container + .checklist_circle + check image. */
    question: string;
    checked: boolean;
    onToggle: (checked: boolean) => void;
}

export function ToggleQuestion({ question, checked, onToggle }: ToggleQuestionProps) {
    return (
        <div className="ds-toggle-question">
            <div
                className="ds-toggle-circle-container"
                role="checkbox"
                aria-checked={checked}
                tabIndex={0}
                onClick={() => onToggle(!checked)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggle(!checked);
                    }
                }}
            >
                <div className={`ds-toggle-circle${checked ? " is-checked" : ""}`} />
            </div>
            <div className="ds-toggle-question-text">{question}</div>
        </div>
    );
}
