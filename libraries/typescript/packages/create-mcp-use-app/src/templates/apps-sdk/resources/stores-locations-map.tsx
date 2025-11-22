import React, { useState } from "react";
import { z } from "zod";
import { useWidget } from "mcp-use/react";
import {
  Button,
  Card,
  Icon,
  Transition,
} from "@openai/apps-sdk-ui";
import "../styles.css";

const propSchema = z.object({
  stores: z
    .array(
      z.object({
        id: z.string().describe("Store ID"),
        name: z.string().describe("Store name"),
        address: z.string().describe("Store address"),
        latitude: z.number().describe("Store latitude"),
        longitude: z.number().describe("Store longitude"),
        phone: z.string().optional().describe("Store phone number"),
        hours: z.string().optional().describe("Store hours"),
        distance: z.number().optional().describe("Distance from user in miles"),
      })
    )
    .describe("Array of store locations"),
  centerLat: z.number().optional().describe("Map center latitude"),
  centerLng: z.number().optional().describe("Map center longitude"),
  zoom: z.number().default(12).describe("Map zoom level"),
});

export const widgetMetadata = {
  description:
    "Display store locations on an interactive map with store details and directions",
  inputs: propSchema,
};

type StoresLocationsMapProps = z.infer<typeof propSchema>;

const StoresLocationsMap: React.FC = () => {
  const { props, theme, callTool, sendFollowUpMessage } =
    useWidget<StoresLocationsMapProps>();
  const { stores, centerLat, centerLng, zoom } = props;
  const [selectedStore, setSelectedStore] = useState<string | null>(null);

  // Calculate center if not provided
  const mapCenterLat =
    centerLat ||
    stores.reduce((sum, store) => sum + store.latitude, 0) / stores.length;
  const mapCenterLng =
    centerLng ||
    stores.reduce((sum, store) => sum + store.longitude, 0) / stores.length;

  const handleStoreClick = async (store: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  }) => {
    setSelectedStore(store.id);
    // Call tool to get store details
    try {
      await callTool("get-store-details", {
        storeId: store.id,
      });
    } catch (error) {
      console.error("Failed to get store details:", error);
    }
  };

  const handleGetDirections = async (store: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  }) => {
    // Call tool to get directions
    try {
      await callTool("get-directions", {
        destination: store.address,
        latitude: store.latitude,
        longitude: store.longitude,
      });
      await sendFollowUpMessage(
        `Getting directions to ${store.name} at ${store.address}`
      );
    } catch (error) {
      console.error("Failed to get directions:", error);
    }
  };

  const bgColor = theme === "dark" ? "bg-gray-900" : "bg-white";
  const textColor = theme === "dark" ? "text-gray-100" : "text-gray-900";
  const subtextColor = theme === "dark" ? "text-gray-400" : "text-gray-600";
  const cardBg = theme === "dark" ? "bg-gray-800" : "bg-gray-50";
  const borderColor =
    theme === "dark" ? "border-gray-700" : "border-gray-200";

  // Generate map URL (using OpenStreetMap as example)
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${
    mapCenterLng - 0.1
  },${mapCenterLat - 0.1},${mapCenterLng + 0.1},${mapCenterLat + 0.1}&layer=mapnik&marker=${mapCenterLat},${mapCenterLng}`;

  return (
    <div className={`${bgColor} rounded-lg p-6 max-w-6xl mx-auto`}>
      <div className="mb-6">
        <h1 className={`text-3xl font-bold ${textColor} mb-2`}>
          Store Locations
        </h1>
        <p className={subtextColor}>
          Find our stores near you ({stores.length} location
          {stores.length !== 1 ? "s" : ""})
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Map Section */}
        <div className="space-y-4">
          <Card className={`${cardBg} p-4 rounded-lg border ${borderColor}`}>
            <div className="w-full h-96 bg-gray-200 rounded-lg overflow-hidden relative">
              {/* Map placeholder - in production, use a real map library */}
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-100 to-green-100">
                <div className="text-center">
                  <Icon name="map" size={64} className="text-gray-500 mb-4" />
                  <p className={subtextColor}>Interactive Map</p>
                  <p className={`${subtextColor} text-sm mt-2`}>
                    Center: {mapCenterLat.toFixed(4)}, {mapCenterLng.toFixed(4)}
                  </p>
                </div>
              </div>

              {/* Store markers */}
              {stores.map((store, index) => (
                <div
                  key={store.id}
                  className="absolute"
                  style={{
                    left: `${50 + (store.longitude - mapCenterLng) * 500}%`,
                    top: `${50 - (store.latitude - mapCenterLat) * 500}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <button
                    onClick={() => handleStoreClick(store)}
                    className={`w-6 h-6 rounded-full border-2 ${
                      selectedStore === store.id
                        ? "bg-blue-500 border-blue-700"
                        : "bg-red-500 border-red-700"
                    } shadow-lg hover:scale-125 transition-transform`}
                    aria-label={store.name}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Map embed fallback */}
          <div className="text-center">
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${textColor} text-sm underline`}
            >
              Open in OpenStreetMap
            </a>
          </div>
        </div>

        {/* Store List */}
        <div className="space-y-4 max-h-[32rem] overflow-y-auto">
          {stores
            .sort((a, b) => (a.distance || 0) - (b.distance || 0))
            .map((store, index) => (
              <Transition
                key={store.id}
                in={true}
                timeout={200}
                style={{ transitionDelay: `${index * 50}ms` }}
              >
                <Card
                  className={`${cardBg} p-4 rounded-lg border ${
                    selectedStore === store.id
                      ? "border-blue-500 shadow-lg"
                      : borderColor
                  } cursor-pointer hover:shadow-md transition-all`}
                  onClick={() => handleStoreClick(store)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className={`text-lg font-semibold ${textColor}`}>
                      {store.name}
                    </h3>
                    {store.distance !== undefined && (
                      <span className={`${subtextColor} text-sm`}>
                        {store.distance.toFixed(1)} mi
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 mb-3">
                    <div className="flex items-start gap-2">
                      <Icon name="location" size={16} className={subtextColor} />
                      <p className={`${subtextColor} text-sm`}>{store.address}</p>
                    </div>

                    {store.phone && (
                      <div className="flex items-center gap-2">
                        <Icon name="phone" size={16} className={subtextColor} />
                        <p className={`${subtextColor} text-sm`}>{store.phone}</p>
                      </div>
                    )}

                    {store.hours && (
                      <div className="flex items-center gap-2">
                        <Icon name="clock" size={16} className={subtextColor} />
                        <p className={`${subtextColor} text-sm`}>{store.hours}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGetDirections(store);
                      }}
                      className="flex-1"
                    >
                      <Icon name="navigation" size={16} className="mr-2" />
                      Directions
                    </Button>
                    <Button
                      variant="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStoreClick(store);
                      }}
                      className="flex-1"
                    >
                      <Icon name="info" size={16} className="mr-2" />
                      Details
                    </Button>
                  </div>
                </Card>
              </Transition>
            ))}
        </div>
      </div>
    </div>
  );
};

export default StoresLocationsMap;
