import type { Metadata } from "next";
import Link from "next/link";
import {
  ShoppingCart,
  Package,
  TrendingUp,
  Users,
  MoreHorizontal,
  Plus,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/layout/page-header";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";

export const metadata: Metadata = { title: "Dashboard" };

/* ─── Mock data ─────────────────────────────────────────────────────────── */

const recentOrders = [
  {
    id: "PO-2441",
    supplier: "Acme Supplies Ltd",
    items: 12,
    amount: "$4,820.00",
    status: "approved" as const,
    date: "May 14, 2026",
  },
  {
    id: "PO-2440",
    supplier: "Global Parts Co",
    items: 5,
    amount: "$1,240.00",
    status: "pending" as const,
    date: "May 13, 2026",
  },
  {
    id: "PO-2439",
    supplier: "TechSource Inc",
    items: 8,
    amount: "$9,100.00",
    status: "processing" as const,
    date: "May 12, 2026",
  },
  {
    id: "PO-2438",
    supplier: "Nortek Supplies",
    items: 3,
    amount: "$540.00",
    status: "completed" as const,
    date: "May 11, 2026",
  },
  {
    id: "PO-2437",
    supplier: "Delta Wholesale",
    items: 20,
    amount: "$22,310.00",
    status: "cancelled" as const,
    date: "May 10, 2026",
  },
];

const activity = [
  {
    id: "1",
    title: "Purchase order PO-2441 approved",
    description: "Approved by James Okonkwo",
    time: "2 hours ago",
    icon: CheckCircle2,
    iconClassName: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "2",
    title: "Low stock alert — SKU-0984",
    description: "Safety stock threshold reached for Bolt M8 x 40",
    time: "5 hours ago",
    icon: AlertCircle,
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
  {
    id: "3",
    title: "Supplier invoice received",
    description: "Global Parts Co — INV-8821 — $1,240.00",
    time: "Yesterday at 4:12 PM",
    icon: Clock,
  },
  {
    id: "4",
    title: "New staff member added",
    description: "Amara Osei joined as Procurement Officer",
    time: "Yesterday at 11:30 AM",
    icon: Users,
  },
];

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of your operations for May 2026"
        actions={
          <Button size="sm">
            <Plus className="size-3.5" />
            New Order
          </Button>
        }
      />

      <PageBody>
        <div className="space-y-6">
          {/* KPI stats */}
          <StatGrid>
            <StatCard
              title="Total Revenue"
              value="$128,450"
              description="vs last month"
              icon={TrendingUp}
              trend={{ value: 12.4 }}
            />
            <StatCard
              title="Open Orders"
              value="34"
              description="6 require attention"
              icon={ShoppingCart}
              trend={{ value: -3.1 }}
            />
            <StatCard
              title="Inventory Items"
              value="1,284"
              description="98 low-stock alerts"
              icon={Package}
              trend={{ value: 0 }}
            />
            <StatCard
              title="Active Suppliers"
              value="62"
              description="3 new this month"
              icon={Users}
              trend={{ value: 5.0 }}
            />
          </StatGrid>

          {/* Main content: table + activity feed */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
            {/* Recent purchase orders */}
            <div className="flex flex-col gap-0 rounded-lg border bg-card shadow-xs">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Recent Purchase Orders
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Last 5 orders across all suppliers
                  </p>
                </div>
                <Link
                  href="/procurement"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  View all
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </div>

              <TableWrapper flush>
                <Table>
                  <TableHead>
                    <tr>
                      <TableColumnHeader>Order ID</TableColumnHeader>
                      <TableColumnHeader>Supplier</TableColumnHeader>
                      <TableColumnHeader align="center">Items</TableColumnHeader>
                      <TableColumnHeader align="right">Amount</TableColumnHeader>
                      <TableColumnHeader>Status</TableColumnHeader>
                      <TableColumnHeader>Date</TableColumnHeader>
                      <TableColumnHeader align="right" />
                    </tr>
                  </TableHead>
                  <TableBody>
                    {recentOrders.map((order) => (
                      <TableRow key={order.id} clickable>
                        <TableCell>
                          <span className="font-medium font-mono text-xs text-foreground">
                            {order.id}
                          </span>
                        </TableCell>
                        <TableCell>{order.supplier}</TableCell>
                        <TableCell align="center" muted>
                          {order.items}
                        </TableCell>
                        <TableCell align="right" className="font-medium tabular-nums">
                          {order.amount}
                        </TableCell>
                        <TableCell>
                          <Badge variant={order.status} dot>
                            {order.status.charAt(0).toUpperCase() +
                              order.status.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell muted>{order.date}</TableCell>
                        <TableCell align="right">
                          <button
                            aria-label="More actions"
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/row:opacity-100 [tr:hover_&]:opacity-100"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>

              <TablePagination
                defaultPage={1}
                totalPages={12}
                totalItems={57}
                pageSize={5}
                className="rounded-b-lg"
              />
            </div>

            {/* Activity feed */}
            <div className="rounded-lg border bg-card shadow-xs">
              <div className="border-b px-5 py-4">
                <h2 className="text-sm font-semibold text-foreground">
                  Recent Activity
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Latest updates across modules
                </p>
              </div>
              <div className="p-5">
                <ActivityFeed items={activity} />
              </div>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
