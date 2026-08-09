import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from "recharts";

const data = [
  { name: "Hybrid", value: 35, color: "#0F5BD3" },
  { name: "Remote", value: 25, color: "#16A34A" },
  { name: "On-site", value: 40, color: "#F59E0B" },
];

export const WorkingFormatChart = () => {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <motion.div
      className="stat-card h-full"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <h3 className="text-lg font-semibold mb-4">Working Format</h3>
      
      <div className="relative h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={5}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        
        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-3xl font-bold text-foreground">{total}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-sm text-muted-foreground">{item.name}</span>
            <span className="text-sm font-medium">{item.value}%</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
};
