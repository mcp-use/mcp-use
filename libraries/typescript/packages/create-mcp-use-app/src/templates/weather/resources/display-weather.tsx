import React from 'react';
import { z } from 'zod';


const propSchema = z.object({
  city: z.string().describe('The city to display weather for'),
  weather: z.enum(['sunny', 'rain', 'snow', 'cloudy']).describe('The weather condition'),
  temperature: z.number().min(-20).max(50).describe('The temperature in Celsius'),
});

export const widgetMetadata = {
  description: 'Display weather for a city',
  inputs: propSchema,
}

const WeatherWidget: React.FC<z.infer<typeof propSchema>> = ({ city, weather, temperature }) => {
  const getWeatherIcon = (weatherType: string) => {
    switch (weatherType?.toLowerCase()) {
      case 'sunny':
        return '☀️';
      case 'rain':
        return '🌧️';
      case 'snow':
        return '❄️';
      case 'cloudy':
        return '☁️';
      default:
        return '🌤️';
    }
  };

  const getWeatherColor = (weatherType: string) => {
    switch (weatherType?.toLowerCase()) {
      case 'sunny':
        return 'from-yellow-400 to-orange-500';
      case 'rain':
        return 'from-blue-400 to-blue-600';
      case 'snow':
        return 'from-blue-100 to-blue-300';
      case 'cloudy':
        return 'from-gray-400 to-gray-600';
      default:
        return 'from-gray-300 to-gray-500';
    }
  };

  return (
    <div className="max-w-sm mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
      <div className={`h-32 bg-gradient-to-br ${getWeatherColor(weather)} flex items-center justify-center`}>
        <div className="text-6xl">{getWeatherIcon(weather)}</div>
      </div>
      
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{city}</h2>
          <div className="flex items-center justify-center space-x-4">
            <span className="text-4xl font-light text-gray-700">{temperature}°</span>
            <div className="text-right">
              <p className="text-lg font-medium text-gray-600 capitalize">{weather}</p>
              <p className="text-sm text-gray-500">Current</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeatherWidget;
