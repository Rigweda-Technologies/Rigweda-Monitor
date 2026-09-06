import { useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { CalendarDays, Plus } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler
);

type ReviewCycle = {
  title: string;
  startDate: string;
  endDate: string;
  notes: string;
};

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        boxWidth: 14,
        color: "#64748b",
        font: {
          size: 12,
        },
      },
    },
  },
  scales: {
    x: {
      grid: {
        color: "#eef2f7",
      },
      ticks: {
        color: "#64748b",
      },
    },
    y: {
      grid: {
        color: "#eef2f7",
      },
      ticks: {
        color: "#64748b",
      },
    },
  },
};

const PerformanceDashboard = () => {
  const [cycleDialogOpen, setCycleDialogOpen] = useState(false);
  const [reviewCycles, setReviewCycles] = useState<ReviewCycle[]>([]);
  const [cycleForm, setCycleForm] = useState<ReviewCycle>({
    title: "",
    startDate: "",
    endDate: "",
    notes: "",
  });

  const summaryCards = [
    { title: "Total Reviews", value: 124 + reviewCycles.length, color: "text-emerald-600" },
    { title: "Pending Self Reviews", value: 18, color: "text-orange-500" },
    { title: "Pending Manager Reviews", value: 9, color: "text-red-500" },
    { title: "Avg Performance Score", value: "4.2 / 5", color: "text-emerald-600" },
  ];

  const barData = useMemo(() => ({
    labels: ["HR", "IT", "Finance", "Sales", "Marketing"],
    datasets: [
      {
        label: "Average Rating",
        data: [4.1, 4.5, 3.9, 4.3, 4.0],
        backgroundColor: "#29b37e",
        borderRadius: 8,
      },
    ],
  }), []);

  const lineData = useMemo(() => ({
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    datasets: [
      {
        label: "Performance Trend",
        data: [3.8, 4.0, 4.1, 4.2, 4.3, 4.2],
        borderColor: "#29b37e",
        backgroundColor: "rgba(41,179,126,0.12)",
        pointBackgroundColor: "#29b37e",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        tension: 0.4,
        fill: true,
      },
    ],
  }), []);

  const createReviewCycle = () => {
    if (!cycleForm.title.trim() || !cycleForm.startDate || !cycleForm.endDate) {
      toast.error("Cycle title, start date, and end date are required");
      return;
    }

    if (new Date(cycleForm.endDate) < new Date(cycleForm.startDate)) {
      toast.error("End date must be after start date");
      return;
    }

    setReviewCycles((current) => [{ ...cycleForm, title: cycleForm.title.trim() }, ...current]);
    setCycleForm({ title: "", startDate: "", endDate: "", notes: "" });
    setCycleDialogOpen(false);
    toast.success("Review cycle created");
  };

  return (
    <MainLayout
      title="Performance Dashboard"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Performance" },
      ]}
    >
      <div className="space-y-6 rounded-[28px] bg-[#f8f8f6] p-3 sm:p-5 lg:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Performance</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Review dashboard</h1>
          </div>
          <Button className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-600" onClick={() => setCycleDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Review Cycle
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.title} className="rounded-[20px] border border-slate-100 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-500">{card.title}</p>
              <p className={`mt-3 text-3xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="rounded-[20px] border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Department Ratings</h2>
            <div className="mt-5 h-[360px]">
              <Bar data={barData} options={chartOptions} />
            </div>
          </div>

          <div className="rounded-[20px] border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Performance Trend</h2>
            <div className="mt-5 h-[360px]">
              <Line data={lineData} options={chartOptions} />
            </div>
          </div>
        </div>

        {reviewCycles.length > 0 && (
          <div className="rounded-[20px] border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Review Cycles</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {reviewCycles.map((cycle) => (
                <div key={`${cycle.title}-${cycle.startDate}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="font-semibold text-slate-950">{cycle.title}</p>
                  <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                    <CalendarDays className="h-4 w-4" />
                    {cycle.startDate} to {cycle.endDate}
                  </p>
                  {cycle.notes && <p className="mt-3 text-sm text-slate-500">{cycle.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Sheet open={cycleDialogOpen} onOpenChange={setCycleDialogOpen}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">Create Review Cycle</SheetTitle>
            <SheetDescription>
              Add a review cycle to the current dashboard session.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="cycle-title">Cycle Title</Label>
              <Input
                id="cycle-title"
                value={cycleForm.title}
                onChange={(event) => setCycleForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Q1 performance review"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cycle-start">Start Date</Label>
                <Input
                  id="cycle-start"
                  type="date"
                  value={cycleForm.startDate}
                  onChange={(event) => setCycleForm((current) => ({ ...current, startDate: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-end">End Date</Label>
                <Input
                  id="cycle-end"
                  type="date"
                  value={cycleForm.endDate}
                  onChange={(event) => setCycleForm((current) => ({ ...current, endDate: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cycle-notes">Notes</Label>
              <Textarea
                id="cycle-notes"
                value={cycleForm.notes}
                onChange={(event) => setCycleForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional review instructions"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setCycleDialogOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={createReviewCycle}>Create Cycle</Button>
          </div>
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default PerformanceDashboard;
