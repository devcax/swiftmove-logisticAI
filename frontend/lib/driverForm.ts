export const vehicleTypes = ["Prime Mover", "Rigid Lorry", "Tipper", "Box Truck", "Flatbed", "Van"];

export interface DriverFormState {
  fullName: string;
  phone: string;
  vehicleType: string;
  licensePlate: string;
}

export type DriverFormErrors = Partial<Record<keyof DriverFormState, string>>;

export function subscriberDigits(raw: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0094")) d = d.slice(4);
  else if (d.startsWith("94")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 9);
}

function groupSubscriber(d: string): string {
  const parts: string[] = [];
  if (d.length > 0) parts.push(d.slice(0, 2));
  if (d.length > 2) parts.push(d.slice(2, 5));
  if (d.length > 5) parts.push(d.slice(5, 9));
  return parts.join(" ");
}

export function formatPhoneInput(raw: string): string {
  return groupSubscriber(subscriberDigits(raw));
}

export function formatPhoneDisplay(e164: string): string {
  const d = subscriberDigits(e164);
  if (d.length === 0) return e164 ?? "";
  return `+94 ${groupSubscriber(d)}`;
}

export function toE164(raw: string): string | null {
  const digits = subscriberDigits(raw);
  if (!/^7\d{8}$/.test(digits)) return null;
  return `+94${digits}`;
}

export function formatPlateInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const letters = cleaned.replace(/[0-9]/g, "").slice(0, 6);
  const digits = cleaned.replace(/[A-Z]/g, "").slice(0, 4);
  if (!digits) return letters;
  return `${letters}-${digits}`;
}

export function isValidPlate(raw: string): boolean {
  return /^[A-Z]{1,2} ?[A-Z]{1,3}-[0-9]{1,4}$/.test(raw.trim().toUpperCase());
}

export function validateDriverForm(form: DriverFormState): DriverFormErrors {
  const errors: DriverFormErrors = {};

  if (form.fullName.trim().length < 3) {
    errors.fullName = "Enter the driver's full name (min. 3 characters)";
  } else if (!/^[A-Za-z][A-Za-z .'-]*$/.test(form.fullName.trim())) {
    errors.fullName = "Name can only contain letters, spaces, apostrophes or hyphens";
  }

  const phoneDigits = subscriberDigits(form.phone);
  if (!phoneDigits) {
    errors.phone = "Phone number is required";
  } else if (phoneDigits.length !== 9) {
    errors.phone = "Enter all 9 digits after +94";
  } else if (!/^7\d{8}$/.test(phoneDigits)) {
    errors.phone = "Mobile number must start with 7 (e.g. 77 123 4567)";
  }

  if (!form.vehicleType) {
    errors.vehicleType = "Select a vehicle type";
  }

  const plate = form.licensePlate.trim().toUpperCase();
  if (!plate) {
    errors.licensePlate = "License plate is required";
  } else if (!isValidPlate(plate)) {
    errors.licensePlate = "Use a format like ED-1234";
  }

  return errors;
}
