export interface Kpi {
  label: string;
  value: number;
  hint: string;
  tone: "primary" | "info" | "success" | "warning" | "error" | "neutral";
}

export const kpis: Kpi[] = [
  { label: "Published Jobs", value: 42, hint: "+6 today", tone: "primary" },
  { label: "Driver Requests", value: 9, hint: "3 new", tone: "info" },
  { label: "Active Jobs", value: 17, hint: "on the road", tone: "primary" },
  { label: "Delayed Jobs", value: 4, hint: "needs review", tone: "warning" },
  { label: "Open Incidents", value: 2, hint: "escalated", tone: "error" },
  { label: "Awaiting Completion", value: 6, hint: "POD pending", tone: "success" },
];

export type JobEventStatus =
  | "AWAITING_PICKUP"
  | "LOADED"
  | "EN_ROUTE"
  | "IN_PROGRESS"
  | "DELAYED"
  | "INCIDENT"
  | "DELIVERED";

export interface ActiveJob {
  jobNumber: string;
  driver: string;
  origin: string;
  destination: string;
  status: JobEventStatus;
  lastUpdate: string;
  lastUpdateAgo: string;
  exception: string | null;
}

export const activeJobs: ActiveJob[] = [
  {
    jobNumber: "JOB-10241",
    driver: "Nuwan Perera",
    origin: "Colombo Port",
    destination: "Kandy DC",
    status: "LOADED",
    lastUpdate: "Loaded 18 pallets, leaving gate 4",
    lastUpdateAgo: "6 min ago",
    exception: null,
  },
  {
    jobNumber: "JOB-10238",
    driver: "Sameera Fonseka",
    origin: "Katunayake",
    destination: "Galle Hub",
    status: "DELAYED",
    lastUpdate: "Stuck in traffic near Panadura",
    lastUpdateAgo: "12 min ago",
    exception: "ETA slipped 45 min",
  },
  {
    jobNumber: "JOB-10236",
    driver: "Kasun Silva",
    origin: "Kelaniya Yard",
    destination: "Jaffna Depot",
    status: "IN_PROGRESS",
    lastUpdate: "Passed Vavuniya checkpoint",
    lastUpdateAgo: "23 min ago",
    exception: null,
  },
  {
    jobNumber: "JOB-10232",
    driver: "Ishara Bandara",
    origin: "Colombo 15",
    destination: "Matara Store",
    status: "IN_PROGRESS",
    lastUpdate: "Refuelling, resuming in 10 min",
    lastUpdateAgo: "38 min ago",
    exception: "Unplanned stop",
  },
  {
    jobNumber: "JOB-10229",
    driver: "Dilan Jayasuriya",
    origin: "Trincomalee",
    destination: "Colombo Port",
    status: "INCIDENT",
    lastUpdate: "Tyre burst, roadside assistance called",
    lastUpdateAgo: "44 min ago",
    exception: "Incident opened",
  },
  {
    jobNumber: "JOB-10225",
    driver: "Tharindu Wickrama",
    origin: "Negombo",
    destination: "Kurunegala",
    status: "LOADED",
    lastUpdate: "Loaded 22 cartons, departing yard",
    lastUpdateAgo: "51 min ago",
    exception: null,
  },
];


export interface Incident {
  id: string;
  jobNumber: string;
  summary: string;
}

export const openIncidents: Incident[] = [
  { id: "INC-3391", jobNumber: "JOB-10229", summary: "Tyre burst near Habarana" },
  { id: "INC-3388", jobNumber: "JOB-10232", summary: "Unplanned stop over 30 min" },
];


export interface RecentAiEvent {
  intent: string;
  detail: string;
  confidence: number;
  tone: "success" | "warning" | "error" | "info";
}

export const recentAiEvents: RecentAiEvent[] = [
  { intent: "LOADED", detail: "18 pallets · JOB-10241", confidence: 96, tone: "success" },
  { intent: "DELAY", detail: "+45 min traffic · JOB-10238", confidence: 89, tone: "warning" },
  { intent: "IN PROGRESS", detail: "Vavuniya checkpoint · JOB-10236", confidence: 92, tone: "info" },
  { intent: "INCIDENT", detail: "Tyre burst · JOB-10229", confidence: 98, tone: "error" },
  { intent: "REFUEL STOP", detail: "Resuming in 10 min · JOB-10232", confidence: 85, tone: "info" },
];


export type JobStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED"
  | "MANAGER_APPROVED";

export interface Job {
  id?: string;
  jobNumber: string;
  status: JobStatus;
  assignmentStatus?: string | null;
  origin: string;
  destination: string;
  window: string;
  cargo: string;
  quantity: string;
  driver: string | null;
}

export const jobs: Job[] = [
  { jobNumber: "JOB-10241", status: "ACTIVE", origin: "Colombo Port", destination: "Kandy DC", window: "28 Aug, 09:00 → 28 Aug, 17:00", cargo: "Mixed FMCG", quantity: "18 pallets", driver: "Nuwan Perera" },
  { jobNumber: "JOB-10238", status: "ACTIVE", origin: "Katunayake", destination: "Galle Hub", window: "28 Aug, 09:00 → 28 Aug, 17:00", cargo: "Mixed FMCG", quantity: "18 pallets", driver: "Sameera Fonseka" },
  { jobNumber: "JOB-10236", status: "ACTIVE", origin: "Kelaniya Yard", destination: "Jaffna Depot", window: "28 Aug, 09:00 → 28 Aug, 17:00", cargo: "Mixed FMCG", quantity: "18 pallets", driver: "Kasun Silva" },
  { jobNumber: "JOB-10232", status: "ACTIVE", origin: "Colombo 15", destination: "Matara Store", window: "28 Aug, 09:00 → 28 Aug, 17:00", cargo: "Mixed FMCG", quantity: "18 pallets", driver: "Ishara Bandara" },
  { jobNumber: "JOB-10229", status: "ACTIVE", origin: "Trincomalee", destination: "Colombo Port", window: "28 Aug, 09:00 → 28 Aug, 17:00", cargo: "Mixed FMCG", quantity: "18 pallets", driver: "Dilan Jayasuriya" },
  { jobNumber: "JOB-10225", status: "ACTIVE", origin: "Negombo", destination: "Kurunegala", window: "28 Aug, 09:00 → 28 Aug, 17:00", cargo: "Mixed FMCG", quantity: "18 pallets", driver: "Tharindu Wickrama" },
  { jobNumber: "JOB-10248", status: "PUBLISHED", origin: "Colombo Port", destination: "Kurunegala", window: "29 Aug, 08:00 → 29 Aug, 15:00", cargo: "Packaged tiles", quantity: "12 tons", driver: null },
  { jobNumber: "JOB-10252", status: "DRAFT", origin: "Colombo Port, Gate 4", destination: "Kandy Distribution Centre", window: "Not scheduled", cargo: "Mixed FMCG cartons", quantity: "18 pallets", driver: null },
  { jobNumber: "JOB-10212", status: "COMPLETED", origin: "Galle Hub", destination: "Matara Store", window: "27 Aug, 07:00 → 27 Aug, 13:30", cargo: "Beverage cartons", quantity: "26 pallets", driver: "Asanka Silva" },
  { jobNumber: "JOB-10198", status: "CANCELLED", origin: "Colombo 15", destination: "Jaffna Depot", window: "25 Aug, 09:00 → 25 Aug, 19:00", cargo: "General cargo", quantity: "8 tons", driver: null },
];

export interface DriverRequest {
  id: string;
  jobNumber: string;
  route: string;
  driver: string;
  truck: string;
  rating: number;
  requestTime: string;
}

export const driverRequests: DriverRequest[] = [
  { id: "REQ-309", jobNumber: "JOB-10248", route: "Colombo Port → Kurunegala", driver: "Roshan Perera", truck: "Isuzu ELF · WP CBA-4412", rating: 4.8, requestTime: "Today, 08:42" },
  { id: "REQ-308", jobNumber: "JOB-10248", route: "Colombo Port → Kurunegala", driver: "Asanka Silva", truck: "Tata LPT · WP CA-8821", rating: 4.6, requestTime: "Today, 08:15" },
  { id: "REQ-306", jobNumber: "JOB-10248", route: "Colombo Port → Kurunegala", driver: "Chamath Dias", truck: "Mitsubishi Canter · SP KC-1934", rating: 4.9, requestTime: "Yesterday, 19:03" },
  { id: "REQ-305", jobNumber: "JOB-10248", route: "Colombo Port → Kurunegala", driver: "Marta Nadeesha", truck: "Hino Dutro · CP NW-5570", rating: 4.7, requestTime: "Yesterday, 17:48" },
];

export type MessageKind = "DRIVER" | "MANAGER" | "BOT" | "AI";

export interface AiInterpretation {
  intent: string;
  confidence: number;
  fields: { label: string; value: string }[];
}

export interface ChatAttachment {
  id: string;
  type: string;
  filename: string | null;
  mimeType: string | null;
  publicUrl: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  kind: MessageKind;
  type?: string;
  text: string;
  time: string;
  interpretation?: AiInterpretation;
  deliveryStatus?: "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  attachments?: ChatAttachment[];
}

export interface Conversation {
  id: string;
  driver: string;
  phone: string;
  jobNumber: string;
  route: string;
  lastMessage: string;
  lastActivity: string;
  unread: number;
  online: boolean;
  verified: boolean;
  aiPaused?: boolean;
  messages: ChatMessage[];
}

export const conversations: Conversation[] = [
  {
    id: "conv-1",
    driver: "Nuwan Perera",
    phone: "+94 77 812 4590",
    jobNumber: "JOB-10241",
    route: "Colombo Port → Kandy DC",
    lastMessage: "Loaded 18 pallets, leaving now",
    lastActivity: "14:32",
    unread: 2,
    online: true,
    verified: true,
    messages: [
      {
        id: "m1",
        kind: "BOT",
        text: "Job JOB-10241 assigned: Colombo Port → Kandy DC. Reply when you reach pickup.",
        time: "09:02",
      },
      {
        id: "m2",
        kind: "DRIVER",
        text: "Reached port, waiting at gate 4",
        time: "09:41",
        interpretation: {
          intent: "ARRIVED_PICKUP",
          confidence: 0.96,
          fields: [
            { label: "Location", value: "Colombo Port - Gate 4" },
            { label: "Job", value: "JOB-10241" },
          ],
        },
      },
      {
        id: "m3",
        kind: "BOT",
        text: "Noted. Pickup arrival logged at 09:41.",
        time: "09:41",
      },
      {
        id: "m4",
        kind: "DRIVER",
        text: "Loading finished, 18 pallets on board machang",
        time: "14:30",
        interpretation: {
          intent: "LOADED",
          confidence: 0.93,
          fields: [
            { label: "Quantity", value: "18 pallets" },
            { label: "Job", value: "JOB-10241" },
          ],
        },
      },
      {
        id: "m5",
        kind: "BOT",
        text: "Status updated to LOADED. Safe travels to Kandy DC.",
        time: "14:30",
      },
      {
        id: "m6",
        kind: "DRIVER",
        text: "Leaving the yard now, will ping at the Kegalle bypass",
        time: "14:32",
        interpretation: {
          intent: "EN_ROUTE",
          confidence: 0.91,
          fields: [
            { label: "Destination", value: "Kandy DC" },
            { label: "Next update", value: "Kegalle bypass" },
          ],
        },
      },
    ],
  },
  {
    id: "conv-2",
    driver: "Sameera Fonseka",
    phone: "+94 71 556 2210",
    jobNumber: "JOB-10238",
    route: "Katunayake → Galle Hub",
    lastMessage: "Traffic block at Panadura",
    lastActivity: "14:18",
    unread: 1,
    online: true,
    verified: true,
    messages: [
      {
        id: "m1",
        kind: "BOT",
        text: "Job JOB-10238 assigned: Katunayake → Galle Hub. Reply when loaded.",
        time: "08:50",
      },
      {
        id: "m2",
        kind: "DRIVER",
        text: "Loaded at Katunayake, heading out",
        time: "11:05",
        interpretation: {
          intent: "LOADED",
          confidence: 0.94,
          fields: [
            { label: "Job", value: "JOB-10238" },
            { label: "Origin", value: "Katunayake" },
          ],
        },
      },
      {
        id: "m3",
        kind: "DRIVER",
        text: "Full traffic block near Panadura, GPS says 45 minutes delay",
        time: "14:12",
        interpretation: {
          intent: "DELAYED",
          confidence: 0.89,
          fields: [
            { label: "Cause", value: "Traffic congestion" },
            { label: "Location", value: "Panadura" },
            { label: "ETA slip", value: "+45 min" },
          ],
        },
      },
      {
        id: "m4",
        kind: "BOT",
        text: "Delay recorded. JOB-10238 flagged DELAYED, Galle Hub notified.",
        time: "14:13",
      },
      {
        id: "m5",
        kind: "MANAGER",
        text: "Thanks Sameera. Keep the reefer running and update me once you clear Panadura.",
        time: "14:18",
      },
    ],
  },
  {
    id: "conv-3",
    driver: "Dilan Jayasuriya",
    phone: "+94 76 902 3317",
    jobNumber: "JOB-10229",
    route: "Trincomalee → Colombo Port",
    lastMessage: "Tyre burst near Habarana",
    lastActivity: "12:44",
    unread: 3,
    online: false,
    verified: true,
    messages: [
      {
        id: "m1",
        kind: "BOT",
        text: "Job JOB-10229 assigned: Trincomalee → Colombo Port.",
        time: "07:10",
      },
      {
        id: "m2",
        kind: "DRIVER",
        text: "Tyre burst near Habarana, rear axle. Truck safe on the shoulder but cannot move.",
        time: "12:38",
        interpretation: {
          intent: "INCIDENT",
          confidence: 0.98,
          fields: [
            { label: "Type", value: "Tyre burst" },
            { label: "Location", value: "Near Habarana" },
            { label: "Drivable", value: "No" },
          ],
        },
      },
      {
        id: "m3",
        kind: "BOT",
        text: "Incident INC-3391 opened. Roadside assistance dispatched — ETA 40 min.",
        time: "12:39",
      },
      {
        id: "m4",
        kind: "MANAGER",
        text: "Stay safe Dilan. Assistance is on the way, I am arranging a backup tractor for the Colombo leg.",
        time: "12:44",
      },
    ],
  },
  {
    id: "conv-4",
    driver: "Ishara Bandara",
    phone: "+94 70 415 6678",
    jobNumber: "JOB-10232",
    route: "Colombo 15 → Matara Store",
    lastMessage: "Ok sir, refuelling",
    lastActivity: "13:20",
    unread: 0,
    online: true,
    verified: true,
    messages: [
      {
        id: "m1",
        kind: "BOT",
        text: "Job JOB-10232 assigned: Colombo 15 → Matara Store.",
        time: "09:20",
      },
      {
        id: "m2",
        kind: "DRIVER",
        text: "Ok sir, refuelling at Piliyandala, resuming in 10 minutes",
        time: "13:20",
        interpretation: {
          intent: "REFUEL_STOP",
          confidence: 0.85,
          fields: [
            { label: "Location", value: "Piliyandala" },
            { label: "Resume", value: "~10 min" },
          ],
        },
      },
      {
        id: "m3",
        kind: "BOT",
        text: "Stop noted. Unplanned stop over 30 min will auto-flag as an incident.",
        time: "13:20",
      },
    ],
  },
];


export type DriverAccountStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "AVAILABLE";

export interface RegisteredDriver {
  id: string;
  name: string;
  phone: string;
  verified: boolean;
  status: DriverAccountStatus;
  currentJob: string | null;
  completedTrips: number;
  vehicleType?: string;
  licensePlate?: string;
}

export const registeredDrivers: RegisteredDriver[] = [
  { id: "d1", name: "Nuwan Perera", phone: "+94 77 812 4590", verified: true, status: "ACTIVE", currentJob: "JOB-10241", completedTrips: 132 },
  { id: "d2", name: "Sameera Fonseka", phone: "+94 71 556 2210", verified: true, status: "ACTIVE", currentJob: "JOB-10238", completedTrips: 98 },
  { id: "d3", name: "Kasun Silva", phone: "+94 77 204 8891", verified: true, status: "ACTIVE", currentJob: "JOB-10236", completedTrips: 205 },
  { id: "d4", name: "Ishara Bandara", phone: "+94 70 415 6678", verified: true, status: "ACTIVE", currentJob: "JOB-10232", completedTrips: 76 },
  { id: "d5", name: "Dilan Jayasuriya", phone: "+94 76 902 3317", verified: true, status: "ACTIVE", currentJob: "JOB-10229", completedTrips: 154 },
  { id: "d6", name: "Tharindu Wickrama", phone: "+94 75 118 9042", verified: true, status: "ACTIVE", currentJob: "JOB-10225", completedTrips: 61 },
  { id: "d7", name: "Roshan Perera", phone: "+94 72 660 1183", verified: false, status: "INACTIVE", currentJob: null, completedTrips: 12 },
  { id: "d8", name: "Vikum Herath", phone: "+94 78 335 7710", verified: false, status: "SUSPENDED", currentJob: null, completedTrips: 47 },
];
