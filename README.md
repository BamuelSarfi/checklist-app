# Checklist-app

![Asset 9](https://github.com/user-attachments/assets/e7490b40-f263-4403-a2bb-f37bb43f8224)

**Checklist-app** is an easy way for small businesses to keep on top of endless hygiene paperwork while being completely self-hosted and mobile-friendly.

By utilizing the UK government issued **Safe Catering** hygiene forms, you can easily create, manage, and fill out daily checklists between employees on their mobile devices. The app then compiles these inputs into official PDF records for compliance.

## Features

*   **Mobile-Friendly Web App:** Accessible from any smartphone or tablet browser; no app store installation required.
*   **UK Safe Catering Compliance:** Built using the official UK government hygiene standards and form structures.
*   **Digital Form Submission:** Employees complete daily checks digitally, replacing paper logs.
*   **Automated PDF Generation:** Form inputs are automatically compiled into professional PDF documents for auditing and storage.
*   **Self-Hosted:** You retain full control over your data and infrastructure.

## Screenshots

<div style="display: flex; flex-wrap: wrap; gap: 10px;">
    <img width="240" alt="Mobile View 1" src="https://github.com/user-attachments/assets/0003a5ab-3b70-470b-8e8a-a274c9c4a4d0" />
    <img width="240" alt="Mobile View 2" src="https://github.com/user-attachments/assets/283e034a-c61e-439e-9f09-cac9ba891213" />
    <img width="240" alt="Mobile View 3" src="https://github.com/user-attachments/assets/9ce983a3-fe96-4594-8a2d-41e04103a3cc" />
    <img width="240" alt="Mobile View 4" src="https://github.com/user-attachments/assets/74026d4c-f3ea-4772-acd6-a80d28207834" />
</div>

## Tech Stack

*   **Frontend:** [Plain HTML/JS]
*   **Backend:** [Node.js]
*   **PDF Generation:** [PDFKit]

## Getting Started

### Prerequisites

*   [e.g., Node.js installed]
*   [e.g., A server or VPS]

### Installation

1.  Clone the repository:
    ```bash
    git clone [https://github.com/BamuelSarfi/checklist-app.git](https://github.com/BamuelSarfi/checklist-app.git)
    ```
2.  Navigate into the directory:
    ```bash
    cd checklist-app
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Configure PORT variable (default 3001) (rename `.env.example` to `.env`):
    ```bash
    mv .env.example .env
    ```
5.  Start the application:
    ```bash
    npm start
    ```

Access the app via `http://localhost:3001` or your configured domain.

## Roadmap

*   [ ] User authentication and roles (Manager vs. Staff).
*   [ ] Historical data dashboard.
*   [ ] Email/Slack notifications for missed checks.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the [MIT License](LICENSE).

---
*Built for compliance using Safe Catering forms © Crown Copyright.*
