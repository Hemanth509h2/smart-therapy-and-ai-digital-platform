# STAAD automation with n8n

The backend only **serves data**; n8n does the scheduling and the WhatsApp sending.
Every endpoint below is under `/api/automation/*` and needs the header
`x-api-key: <AUTOMATION_API_KEY>` (set `AUTOMATION_API_KEY` in the backend `.env`).
Without it, or if the env var is empty, every call is a 401.

## Endpoints

| Endpoint | For | Returns |
|---|---|---|
| `GET /api/automation/doctors/schedule?date=YYYY-MM-DD&doctorId=` | 7 AM digest | Every doctor (name, specialty, qualification, experience, phone) with that IST day's scheduled/active sessions, `shouldSend`, and a ready-to-send `message`. Default date: today (IST). |
| `GET /api/automation/reminders?fromMinutes=60&toMinutes=75` | Reminders | Scheduled sessions starting in that window whose client has a WhatsApp number, each with the client's phone and a ready `message`. |
| `POST /api/automation/sessions/{sessionId}/join-link` | Send join link | Creates or reuses the client's join link; returns `link`, client phone, `shouldSend`, `message`. Sends nothing. |
| `GET /api/automation/doctor/overview?phone=` | Chatbot | The doctor's profile, today's sessions, next 7 days, counts. 404 if the number is not a doctor. |
| `GET /api/automation/doctor/schedule?phone=&from=&to=&status=` | Chatbot | The doctor's sessions between two IST days (max 31 days). |
| `GET /api/automation/doctor/clients?phone=&q=` | Chatbot | The doctor's clients with session counts and last/next session. |
| `GET /api/automation/doctor/client?phone=&clientId=` | Chatbot | One client's details and session history (latest 20). No clinical notes or reports. |

`phone` is the WhatsApp number the message came from, in any format
(`919876543210`, `+91 98765 43210`, `9876543210`). The chatbot endpoints only ever return
data for the doctor who owns that number.

Quick check:

```bash
curl -H "x-api-key: $KEY" "https://YOUR-BACKEND-URL/api/automation/doctors/schedule"
curl -H "x-api-key: $KEY" "https://YOUR-BACKEND-URL/api/automation/doctor/overview?phone=919876543210"
```

## Workflows (import each file: n8n > Workflows > Import from file)

| File | Trigger | What it does |
|---|---|---|
| `01-daily-doctor-schedule.json` | Every day 07:00 IST | Gets all doctors' schedules, WhatsApps each doctor who has sessions their day. |
| `02-session-reminders.json` | Every 15 minutes | Reminders to clients 1 hour and 24 hours before their session. |
| `03-send-session-link.json` | Webhook `POST /webhook/staad-send-session-link` with `{"sessionId": "..."}` | Creates the join link and WhatsApps it to the client. |
| `04-doctor-chatbot.json` | Incoming WhatsApp message | Looks up the doctor by their number and answers questions about their schedule, sessions and clients with an AI agent. |

After importing each workflow:

1. Replace `https://YOUR-BACKEND-URL` in the HTTP nodes with your backend URL.
2. Create a **Header Auth** credential: name `x-api-key`, value your `AUTOMATION_API_KEY`, and pick it on every HTTP node.
3. Create your **WhatsApp Business Cloud** credentials, pick them on the WhatsApp nodes, and set `YOUR_WHATSAPP_PHONE_NUMBER_ID`.
4. Workflow 04 also needs an **Anthropic** credential on the chat model (re-pick the model if the name is not in your list) and the WhatsApp **Trigger** credential and webhook set up in Meta.
5. Activate the workflow. The workflow timezone is already set to Asia/Kolkata.

## Things to know

- **WhatsApp's 24-hour rule.** Plain text only reaches someone who messaged your number in the last 24 hours. The 7 AM digest, reminders and join links are messages you start, so they need **approved message templates**. Until you have them, swap the WhatsApp "Send" node for "Send template" (the backend's `message` text is a good template body). The chatbot replies are fine as plain text because the doctor messaged first.
- **Reminders are stateless.** Each run asks for a window exactly as wide as the schedule interval (15 minutes), so each session falls into exactly one run. If n8n is down for a run, that window's reminders are missed, and if the schedule is changed from 15 minutes, change `toMinutes - fromMinutes` to match.
- **The doctor must have a WhatsApp number** on their STAAD profile (`phoneNumber`), or the chatbot says they are not registered and the digest skips them.
- **Chatbot privacy.** The phone number is fixed inside each tool (taken from the incoming message), so the AI cannot ask for another doctor's data. Clinical notes and reports are not exposed.
- These workflows were generated, not run inside n8n. Open each one after import and check the nodes show no errors; n8n node versions differ slightly between releases.
