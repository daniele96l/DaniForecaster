import pandas as pd
import matplotlib.pyplot as plt

solar = pd.read_csv('Solar.csv', header=2)
solar['Date'] = pd.to_datetime(solar['Date'], format='%d/%m/%Y %H:%M')
solar['Production, KWh'] = solar['Production, KWh'].astype(float)

year = 1990
solar_year = solar[solar['Date'].dt.year == year]

fig, axes = plt.subplots(3, 4, figsize=(16, 8), sharey=True)
axes = axes.flatten()

for month in range(1, 13):
    ax = axes[month - 1]
    solar_month = solar_year[solar_year['Date'].dt.month == month]
    ax.plot(solar_month['Date'], solar_month['Production, KWh'])
    ax.set_title(f'{month:02d}/{year}')
    ax.tick_params(axis='x', rotation=45)

for ax in axes:
    ax.set_xlabel('Date')
    ax.set_ylabel('Production (kWh)')

plt.tight_layout()
plt.show()
