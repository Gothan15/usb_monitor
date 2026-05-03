import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, { role: "admin", enforceCsrf: false });

    const searchParams = req.nextUrl.searchParams;
    const q = searchParams.get("q") || "";
    const categoriesParam = searchParams.get("categories");
    
    // Si no hay query, retornamos vacio
    if (!q || q.length < 2) {
      return NextResponse.json({
        users: [],
        computers: [],
        whitelist: [],
        events: []
      });
    }

    const activeCategories = categoriesParam 
      ? categoriesParam.split(",") 
      : ["users", "computers", "whitelist", "events"];

    const searchStr = q.trim();

    // Promesas para consultas concurrentes
    const promises: Promise<any>[] = [];
    const results: Record<string, any[]> = {
      users: [],
      computers: [],
      whitelist: [],
      events: []
    };

    if (activeCategories.includes("users")) {
      promises.push(
        db.user.findMany({
          where: {
            OR: [
              { username: { contains: searchStr, mode: "insensitive" } },
            ]
          },
          select: { id: true, username: true, role: true },
          take: 5
        }).then(res => { results.users = res; })
      );
    }

    if (activeCategories.includes("computers")) {
      promises.push(
        db.computer.findMany({
          where: {
            OR: [
              { name: { contains: searchStr, mode: "insensitive" } },
              { ipAddress: { contains: searchStr, mode: "insensitive" } }
            ]
          },
          select: { id: true, name: true, ipAddress: true },
          take: 5
        }).then(res => { results.computers = res; })
      );
    }

    if (activeCategories.includes("whitelist")) {
      promises.push(
        db.uSBWhitelist.findMany({
          where: {
            OR: [
              { serialNumber: { contains: searchStr, mode: "insensitive" } },
              { label: { contains: searchStr, mode: "insensitive" } }
            ]
          },
          select: { id: true, serialNumber: true, label: true },
          take: 5
        }).then(res => { results.whitelist = res; })
      );
    }

    if (activeCategories.includes("events")) {
      promises.push(
        db.uSBEvent.findMany({
          where: {
            OR: [
              { pcName: { contains: searchStr, mode: "insensitive" } },
              { pcIp: { contains: searchStr, mode: "insensitive" } },
              { pcUser: { contains: searchStr, mode: "insensitive" } },
              { serialNumber: { contains: searchStr, mode: "insensitive" } }
            ]
          },
          select: { id: true, pcName: true, event: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 5
        }).then(res => { results.events = res; })
      );
    }

    await Promise.all(promises);

    return NextResponse.json(results);

  } catch (error) {
    console.error("Search API Error:", error);
    return NextResponse.json(
      { error: "Error en la búsqueda" },
      { status: 500 }
    );
  }
}
