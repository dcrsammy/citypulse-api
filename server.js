const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();

app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use("/api/auth",          require("./routes/auth"));
app.use("/api/venues",        require("./routes/venues"));
app.use("/api/events",        require("./routes/events"));
app.use("/api/bookings",      require("./routes/bookings"));
app.use("/api/reviews",       require("./routes/reviews"));
app.use("/api/rewards",       require("./routes/rewards"));
app.use("/api/wallet",        require("./routes/wallet"));
app.use("/api/payments",      require("./routes/payments"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/vendor",        require("./routes/vendor"));
app.use("/api/admin",         require("./routes/admin"));
app.use("/api/menu",         require("./routes/menu"));
app.use("/api/food-orders", require("./routes/foodOrders"));
app.use("/api/promo",       require("./routes/promo"));
app.use("/api/promo",        require("./routes/promo"));
app.use("/api/promo",       require("./routes/promo"));
app.use("/api/reservations", require("./routes/reservations"));
app.use("/api/services",     require("./routes/services"));

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "CityPulse API", version: "1.0.0" });
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CityPulse API running on port ${PORT}`));