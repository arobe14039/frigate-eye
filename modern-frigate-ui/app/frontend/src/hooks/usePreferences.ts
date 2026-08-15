import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import type { Preferences } from "../types";

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: api.session, staleTime: 5 * 60_000 });
}

export function usePreferences() {
  const queryClient = useQueryClient();
  const session = useSession();

  const mutation = useMutation({
    mutationFn: (patch: Partial<Preferences>) => api.savePreferences(patch),
    onMutate: async (patch) => {
      queryClient.setQueryData(["session"], (previous: any) =>
        previous ? { ...previous, preferences: { ...previous.preferences, ...patch } } : previous,
      );
    },
  });

  const preferences = session.data?.preferences;

  return {
    preferences,
    userName: session.data?.userName ?? null,
    update: (patch: Partial<Preferences>) => mutation.mutate(patch),
    toggleFavorite: (cameraId: string) => {
      const favorites = preferences?.favorites ?? [];
      mutation.mutate({
        favorites: favorites.includes(cameraId)
          ? favorites.filter((id) => id !== cameraId)
          : [...favorites, cameraId],
      });
    },
  };
}
