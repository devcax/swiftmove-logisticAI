"use server";

import { cookies } from "next/headers";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export type VerifyPinResult = { success: true } | { success: false; error: string };

export async function verifyPin(pin: string): Promise<VerifyPinResult> {
  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) {
    console.error("verifyPin: ADMIN_PIN is not configured — refusing login.");
    return { success: false, error: "Login is not configured on this server." };
  }

  if (String(pin ?? "").trim() !== adminPin) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { success: false, error: "Incorrect PIN. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return { success: true };
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
