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
    npm run start
    ```

Access the app via `http://localhost:3001` or your configured domain.

# Setting Up Checklist-App for your business
contact barfisamuel29@gmail.com for to discuss plans & prices.

# Setting Up Checklist-App on a VPS for Local Network Access

Follow this step-by-step guide via Bash to set up your checklist app on a VPS or local server, make it accessible to other devices on the same network, and configure a custom local domain name (e.g., `http://checklist.local`) for easy mobile access.

---

### Step 1: Clone and Set Up the Application

First, SSH into your server, navigate to your desired directory, and clone your project repository:

```bash
# Clone the repository
git clone [https://github.com/YOUR-USERNAME/checklist-app.git](https://github.com/YOUR-USERNAME/checklist-app.git)
cd checklist-app

# Install dependencies (assuming Node.js backend)
npm install

# Build the production assets if required by your framework
npm run build
```
Step 2: Configure a Process Manager (PM2)

To keep your application running persistently in the background, use PM2:

# Install PM2 globally

```bash
sudo npm install -g pm2
```

# Start the application

```bash
pm2 start server.js --name "checklist-app"
```

# Configure PM2 to start on system boot

```bash
pm2 startup
pm2 save
```

Step 3: Install and Configure Nginx (Reverse Proxy)

Nginx will route incoming local network requests to your Node application and allow you set up a custom domain name.
```bash
# Install Nginx
sudo apt update
sudo apt install nginx -y

# Create a new Nginx configuration file for your app
sudo nano /etc/nginx/sites-available/checklist-app
```
Paste the following configuration into the file (replace 3001 with the actual port the app runs on):

```bash
server {
    listen 80;
    server_name checklist.local;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Enable the site and restart Nginx:
```bash
# Enable the site configuration
sudo ln -s /etc/nginx/sites-available/checklist-app /etc/nginx/sites-enabled/

# Test the Nginx configuration for syntax errors
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```
If your router supports local DNS routing or Host Mapping / Local Domain Name configurations, add a DNS entry mapping to link the custom URL to the ip of the host machine.

## Roadmap

*   [ ] User authentication and roles (Manager vs. Staff).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the [MIT License](LICENSE).

---
