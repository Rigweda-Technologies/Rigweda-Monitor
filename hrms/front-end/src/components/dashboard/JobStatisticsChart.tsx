import { useState } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const data = [
  { month: "Jan", jobView: 120, jobApplied: 45 },
  { month: "Feb", jobView: 150, jobApplied: 62 },
  { month: "Mar", jobView: 180, jobApplied: 78 },
  { month: "Apr", jobView: 165, jobApplied: 55 },
  { month: "May", jobView: 200, jobApplied: 85 },
  { month: "Jun", jobView: 220, jobApplied: 92 },
];

export const JobStatisticsChart = () => {
  const [activeView, setActiveView] = useState<"both" | "view" | "applied">("both");

  return (
    <motion.div
      className="stat-card h-full"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Job Statistics</h3>
        <div className="flex gap-2">
          {["both", "view", "applied"].map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view as typeof activeView)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeView === view
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {view === "both" ? "All" : view === "view" ? "Job View" : "Applied"}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={8}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E6EAF0" />
            <XAxis 
              dataKey="month" 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 12 }}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #E6EAF0',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            />
            {(activeView === "both" || activeView === "view") && (
              <Bar 
                dataKey="jobView" 
                name="Job View"
                fill="#0F5BD3" 
                radius={[4, 4, 0, 0]}
              />
            )}
            {(activeView === "both" || activeView === "applied") && (
              <Bar 
                dataKey="jobApplied" 
                name="Job Applied"
                fill="#16A34A" 
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};
