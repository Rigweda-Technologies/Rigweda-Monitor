import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const data = [
  { month: "Jan", netCost: 12000, returns: 8000 },
  { month: "Feb", netCost: 15000, returns: 10000 },
  { month: "Mar", netCost: 18000, returns: 14000 },
  { month: "Apr", netCost: 14000, returns: 11000 },
  { month: "May", netCost: 20000, returns: 16000 },
  { month: "Jun", netCost: 22000, returns: 19000 },
  { month: "Jul", netCost: 19000, returns: 17000 },
  { month: "Aug", netCost: 25000, returns: 21000 },
  { month: "Sep", netCost: 23000, returns: 20000 },
  { month: "Oct", netCost: 28000, returns: 24000 },
  { month: "Nov", netCost: 26000, returns: 22000 },
  { month: "Dec", netCost: 30000, returns: 27000 },
];

export const TrainingCostChart = () => {
  return (
    <motion.div
      className="stat-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Training Cost Overview</h3>
        <Select defaultValue="2024">
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Select year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
            <SelectItem value="2022">2022</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
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
              tickFormatter={(value) => `$${value / 1000}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #E6EAF0',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
            />
            <Legend 
              verticalAlign="top" 
              height={36}
              iconType="circle"
            />
            <Line
              type="monotone"
              dataKey="netCost"
              name="Net Cost"
              stroke="#0F5BD3"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6, fill: '#0F5BD3' }}
            />
            <Line
              type="monotone"
              dataKey="returns"
              name="Returns"
              stroke="#16A34A"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6, fill: '#16A34A' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};
