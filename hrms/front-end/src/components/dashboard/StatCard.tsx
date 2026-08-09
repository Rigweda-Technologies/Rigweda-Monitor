import { ReactNode } from "react";
import { motion } from "framer-motion";
import { MoreVertical, TrendingUp, TrendingDown } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: ReactNode;
  link?: { label: string; href: string };
  chartData?: { value: number }[];
  chartColor?: string;
  delay?: number;
}

export const StatCard = ({
  title,
  value,
  change,
  changeLabel,
  icon,
  link,
  chartData,
  chartColor = "#0F5BD3",
  delay = 0,
}: StatCardProps) => {
  const isPositive = change && change >= 0;

  return (
    <motion.div
      className="stat-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-3 rounded-xl bg-primary/10">
          <span className="text-primary">{icon}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1 rounded hover:bg-muted transition-colors">
            <MoreVertical className="w-4 h-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>View Details</DropdownMenuItem>
            <DropdownMenuItem>Refresh</DropdownMenuItem>
            <DropdownMenuItem>Export</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <p className="text-3xl font-bold text-foreground">{value}</p>
          
          {change !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-success" />
              ) : (
                <TrendingDown className="w-4 h-4 text-destructive" />
              )}
              <span className={isPositive ? "text-success text-sm font-medium" : "text-destructive text-sm font-medium"}>
                {isPositive ? "+" : ""}{change}%
              </span>
              {changeLabel && (
                <span className="text-muted-foreground text-sm">{changeLabel}</span>
              )}
            </div>
          )}

          {link && (
            <a href={link.href} className="link-primary mt-3 inline-block">
              {link.label} →
            </a>
          )}
        </div>

        {chartData && (
          <div className="w-24 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={chartColor}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </motion.div>
  );
};
