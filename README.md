# SwiftMove Logistics

Operations dashboard and WhatsApp workflow for managing drivers, jobs, deliveries, incidents, and document-code verification.

Live demo: [https://swiftmove.devcax.com](https://swiftmove.devcax.com)

## Try the live demo

1. Open the [live demo](https://swiftmove.devcax.com) and sign in with password `1234`.
2. In **Drivers**, add your WhatsApp phone number as a driver.
3. In **Jobs**, create and publish a job that matches that driver.
4. Open the [WhatsApp chat](https://wa.me/94756941491), ask for `available jobs`, and chat in your preferred language.
5. Apply for the job, accept it when offered, and send `start` to begin the trip.
6. Upload the provided pickup-code proof image, then the delivery-code proof image at the relevant stages.
7. Complete the trip through WhatsApp. The dashboard shows job progress, driver activity, messages, document verification, and incidents in real time.

## Try locally

### Requirements

- Git
- Docker Desktop running with Linux containers

### Clone and configure

```powershell
git clone https://github.com/devcax/swiftmove-logisticAI.git
cd logistic_AI
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Set the real credentials in `backend/.env`. Set these values in `frontend/.env`:

```env
ADMIN_PIN=<your-admin-pin>
SESSION_SECRET=<long-random-secret>
```

### Run with Docker Compose

Start the app:

```powershell
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

## Technologies

- **Frontend:** Next.js 16, React 19, TypeScript, Material UI, Tailwind CSS
- **Backend:** Node.js, Express 5, PostgreSQL, `pg`
- **Messaging:** WhatsApp Cloud API webhooks
- **Storage:** Cloudflare R2 using the AWS S3 SDK
- **Deployment:** Docker, Docker Compose, Amazon ECR Public
- **LLM and AI:**
  - **Qwen3.8-27B** for structured driver-message interpretation
  - Meta **Llama Prompt Guard 2 86M** for prompt-injection screening
  - **Whisper Large v3** for voice-message transcription
  - Configurable vision model (**GPT-4o mini**) for document-code extraction and incident-photo classification
