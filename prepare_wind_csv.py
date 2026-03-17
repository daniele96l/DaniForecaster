#!/usr/bin/env python

import pandas as pd

df = pd.read_excel("Wind.xlsx", header=2)
df = df.drop(columns=['Unnamed: 25'], errors='ignore')
df.rename(columns={df.columns[0]: 'Date'}, inplace=True)
df['Date'] = pd.to_datetime(df['Date'])

# Melt to long format
df_melted = df.melt(id_vars='Date', var_name='Hour', value_name='Production, KWh')

# Create datetime with hour offset
df_melted['Hour'] = pd.to_numeric(df_melted['Hour'], errors='coerce')
df_melted['Date'] = df_melted['Date'] + pd.to_timedelta(df_melted['Hour'] - 1, unit='h')

# Format as MM/DD/YYYY HH:MM
df_melted['Date'] = df_melted['Date'].dt.strftime('%m/%d/%Y %H:%M')

result = df_melted[['Date', 'Production, KWh']].dropna()

result.to_csv("Wind.csv", index=False)
