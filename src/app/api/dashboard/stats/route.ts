import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { addMillisecondsToNow } from "@/lib/time";

export async function GET(req: Request) {
  try {
    await requireAuth(req);

    const fiveMinutesAgo = addMillisecondsToNow(-5 * 60 * 1000);
    const twelveHoursAgo = addMillisecondsToNow(-12 * 60 * 60 * 1000);

    const [
      totalComputers,
      onlineComputers,
      totalEvents,
      pendingEvents,
      recentEvents,
      latestAlerts,
      whitelistCount,
      serviceRunningCount,
      serviceRespondingCount,
    ] = await Promise.all([
      db.computer.count(),
      db.computer.count({
        where: {
          lastSeen: {
            gt: fiveMinutesAgo,
          },
        },
      }),
      db.uSBEvent.count(),
      db.uSBEvent.count({
        where: {
          whitelisted: false,
        },
      }),
      // Events for the chart (last 12 hours) - lightweight selection
      db.uSBEvent.findMany({
        where: {
          createdAt: {
            gt: twelveHoursAgo,
          },
        },
        select: {
          createdAt: true,
          whitelisted: true,
          event: true,
          serialNumber: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
      // Recent alerts for the list (non-whitelisted, last 6)
      db.uSBEvent.findMany({
        where: {
          whitelisted: false,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 6,
        select: {
          id: true,
          pcName: true,
          pcUser: true,
          event: true,
          createdAt: true,
        },
      }),
      db.uSBWhitelist.count(),
      db.computer.count({
        where: {
          serviceRunning: true,
        },
      }),
      db.computer.count({
        where: {
          lastServiceCheck: {
            not: null,
          },
        },
      }),
    ]);

    return NextResponse.json({
      totalComputers,
      onlineComputers,
      totalEvents,
      pendingEvents,
      recentEvents, // For the chart
      latestAlerts, // For the alerts list
      whitelistCount,
      serviceRunningCount,
      serviceRespondingCount,
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Error interno al obtener estadísticas" },
      { status: 500 }
    );
  }
}
