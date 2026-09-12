import React from "react";
import "./Card.css";

export type CardVariant = "list-item" | "list-item-column" | "record" | "row";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Unifies the five independently-declared card containers found in
     * style.css: .checklist_card ("list-item"), .checklist_card_l
     * ("list-item-column"), .sc1_record_card ("record"), and
     * .sc4_row_card / .sc3_row_container ("row"). */
    variant?: CardVariant;
    completed?: boolean;
    onClick?: () => void;
}

export function Card({
    variant = "row",
    completed = false,
    className,
    children,
    onClick,
    ...rest
}: CardProps) {
    const classes = [
        "ds-card",
        `ds-card--${variant}`,
        completed ? "is-completed" : "",
        className || "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={classes} onClick={onClick} {...rest}>
            {children}
        </div>
    );
}

export function CardHeader({ children }: { children: React.ReactNode }) {
    return <div className="ds-card-header">{children}</div>;
}

export function CardTitle({ children }: { children: React.ReactNode }) {
    return <p className="ds-card-title">{children}</p>;
}

export function CardDescription({ children }: { children: React.ReactNode }) {
    return <p className="ds-card-description">{children}</p>;
}

export function CardArrow({ children = "→" }: { children?: React.ReactNode }) {
    return <div className="ds-card-arrow">{children}</div>;
}

export function CardBadge({ children }: { children: React.ReactNode }) {
    return <span className="ds-card-badge">{children}</span>;
}
