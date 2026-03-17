from common_plot import load_solar_like_csv, plot_month_grid

solar = load_solar_like_csv("Solar.csv")
year = 1990
plot_month_grid(solar, year, "Solar")
