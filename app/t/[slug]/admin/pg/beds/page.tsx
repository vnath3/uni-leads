"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTenantContext } from "@/components/TenantContextProvider";

type Room = {
  id: string;
  name: string;
  floor?: string | null;
  capacity?: number | null;
  notes?: string | null;
};

type Bed = {
  id: string;
  bed_code: string;
  status: "available" | "occupied" | "maintenance" | "blocked";
  notes?: string | null;
  room_id?: string | null;
  pg_rooms?: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
};

type RoomFormState = {
  name: string;
  floor: string;
  capacity: string;
  notes: string;
};

type BedFormState = {
  bedCode: string;
  roomId: string;
  status: Bed["status"];
  notes: string;
};

const bedStatusOptions: Bed["status"][] = [
  "available",
  "occupied",
  "maintenance",
  "blocked"
];

const getRoomName = (bed: Bed) => {
  const room = Array.isArray(bed.pg_rooms) ? bed.pg_rooms[0] : bed.pg_rooms;
  return room?.name ?? "Unassigned";
};

export default function PgBedsPage() {
  const { tenant, canWrite } = useTenantContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"rooms" | "beds">("rooms");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [roomForm, setRoomForm] = useState<RoomFormState>({
    name: "",
    floor: "",
    capacity: "",
    notes: ""
  });
  const [bedForm, setBedForm] = useState<BedFormState>({
    bedCode: "",
    roomId: "",
    status: "available",
    notes: ""
  });
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingBedId, setEditingBedId] = useState<string | null>(null);
  const [roomEdit, setRoomEdit] = useState<RoomFormState | null>(null);
  const [bedEdit, setBedEdit] = useState<BedFormState | null>(null);
  const [bedStatusFilter, setBedStatusFilter] = useState<Bed["status"] | "all">(
    "all"
  );
  const [bedRoomFilter, setBedRoomFilter] = useState<string>("all");

  const readOnly = tenant.supportMode === "ro" || !canWrite;
  const roTooltip = tenant.supportMode === "ro" ? "Disabled in RO" : undefined;
  const hasBeds = tenant.enabledFeatureKeys.includes("pg.beds");

  const roomById = useMemo(() => {
    const map: Record<string, Room> = {};
    for (const room of rooms) {
      map[room.id] = room;
    }
    return map;
  }, [rooms]);

  const filteredBeds = useMemo(() => {
    return beds.filter((bed) => {
      if (bedStatusFilter !== "all" && bed.status !== bedStatusFilter) {
        return false;
      }
      if (bedRoomFilter !== "all" && bed.room_id !== bedRoomFilter) {
        return false;
      }
      return true;
    });
  }, [beds, bedStatusFilter, bedRoomFilter]);

  useEffect(() => {
    if (!hasBeds) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const [roomsRes, bedsRes] = await Promise.all([
        supabase
          .from("pg_rooms")
          .select("id, name, floor, capacity, notes")
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("pg_beds")
          .select("id, bed_code, status, notes, room_id, pg_rooms:room_id (id, name)")
          .eq("tenant_id", tenant.tenantId)
          .is("deleted_at", null)
          .order("bed_code")
      ]);

      if (!active) return;

      const firstError = roomsRes.error || bedsRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      setRooms((roomsRes.data as Room[]) ?? []);
      setBeds((bedsRes.data as Bed[]) ?? []);
      setLoading(false);
    };

    loadData();

    return () => {
      active = false;
    };
  }, [tenant.tenantId, hasBeds]);

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    const trimmedName = roomForm.name.trim();
    if (!trimmedName) {
      setError("Room name is required.");
      return;
    }

    const capacityValue =
      roomForm.capacity.trim() === "" ? null : Number(roomForm.capacity);
    if (capacityValue !== null && Number.isNaN(capacityValue)) {
      setError("Capacity must be a number.");
      return;
    }

    setError(null);

    const { data, error: insertError } = await supabase
      .from("pg_rooms")
      .insert({
        tenant_id: tenant.tenantId,
        name: trimmedName,
        floor: roomForm.floor.trim() || null,
        capacity: capacityValue,
        notes: roomForm.notes.trim() || null
      })
      .select("id, name, floor, capacity, notes")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setRooms((prev) => [...prev, data as Room].sort((a, b) => a.name.localeCompare(b.name)));
    setRoomForm({ name: "", floor: "", capacity: "", notes: "" });
  };

  const startRoomEdit = (room: Room) => {
    setEditingRoomId(room.id);
    setRoomEdit({
      name: room.name ?? "",
      floor: room.floor ?? "",
      capacity: room.capacity !== null && room.capacity !== undefined ? String(room.capacity) : "",
      notes: room.notes ?? ""
    });
  };

  const handleUpdateRoom = async (roomId: string) => {
    if (!roomEdit) return;
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    const trimmedName = roomEdit.name.trim();
    if (!trimmedName) {
      setError("Room name is required.");
      return;
    }

    const capacityValue =
      roomEdit.capacity.trim() === "" ? null : Number(roomEdit.capacity);
    if (capacityValue !== null && Number.isNaN(capacityValue)) {
      setError("Capacity must be a number.");
      return;
    }

    setError(null);

    const { error: updateError } = await supabase
      .from("pg_rooms")
      .update({
        name: trimmedName,
        floor: roomEdit.floor.trim() || null,
        capacity: capacityValue,
        notes: roomEdit.notes.trim() || null
      })
      .eq("id", roomId)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setRooms((prev) =>
      prev.map((room) =>
        room.id === roomId
          ? {
              ...room,
              name: trimmedName,
              floor: roomEdit.floor.trim() || null,
              capacity: capacityValue,
              notes: roomEdit.notes.trim() || null
            }
          : room
      )
    );
    setEditingRoomId(null);
    setRoomEdit(null);
  };

  const handleCreateBed = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    const trimmedCode = bedForm.bedCode.trim();
    if (!trimmedCode) {
      setError("Bed code is required.");
      return;
    }

    setError(null);

    const { data, error: insertError } = await supabase
      .from("pg_beds")
      .insert({
        tenant_id: tenant.tenantId,
        bed_code: trimmedCode,
        status: bedForm.status,
        room_id: bedForm.roomId || null,
        notes: bedForm.notes.trim() || null
      })
      .select("id, bed_code, status, notes, room_id, pg_rooms:room_id (id, name)")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setBeds((prev) =>
      [...prev, data as Bed].sort((a, b) => a.bed_code.localeCompare(b.bed_code))
    );
    setBedForm({ bedCode: "", roomId: "", status: "available", notes: "" });
  };

  const startBedEdit = (bed: Bed) => {
    setEditingBedId(bed.id);
    setBedEdit({
      bedCode: bed.bed_code ?? "",
      roomId: bed.room_id ?? "",
      status: bed.status ?? "available",
      notes: bed.notes ?? ""
    });
  };

  const handleUpdateBed = async (bedId: string) => {
    if (!bedEdit) return;
    if (readOnly) {
      setError("Read-only support access.");
      return;
    }

    const trimmedCode = bedEdit.bedCode.trim();
    if (!trimmedCode) {
      setError("Bed code is required.");
      return;
    }

    setError(null);

    const { error: updateError } = await supabase
      .from("pg_beds")
      .update({
        bed_code: trimmedCode,
        room_id: bedEdit.roomId || null,
        status: bedEdit.status,
        notes: bedEdit.notes.trim() || null
      })
      .eq("id", bedId)
      .eq("tenant_id", tenant.tenantId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setBeds((prev) =>
      prev.map((bed) =>
        bed.id === bedId
          ? {
              ...bed,
              bed_code: trimmedCode,
              room_id: bedEdit.roomId || null,
              status: bedEdit.status,
              notes: bedEdit.notes.trim() || null,
              pg_rooms: bedEdit.roomId ? roomById[bedEdit.roomId] : null
            }
          : bed
      )
    );
    setEditingBedId(null);
    setBedEdit(null);
  };

  if (!hasBeds) {
    return (
      <div className="card">
        <h1>Beds & Rooms</h1>
        <p className="muted">Module disabled for this tenant.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h1>Loading beds...</h1>
        <p className="muted">Fetching room and bed data.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h1>Beds & Rooms</h1>
        <p className="muted">Manage room inventory and bed availability.</p>
        {readOnly && (
          <div className="notice">Read-only support access is enabled.</div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="section">
          <div className="section-title">View</div>
          <div className="tag-list">
            <button
              type="button"
              className={`button ${activeTab === "rooms" ? "" : "secondary"}`}
              onClick={() => setActiveTab("rooms")}
            >
              Rooms
            </button>
            <button
              type="button"
              className={`button ${activeTab === "beds" ? "" : "secondary"}`}
              onClick={() => setActiveTab("beds")}
            >
              Beds
            </button>
          </div>
        </div>
      </div>

      {activeTab === "rooms" && (
        <>
          <div className="card">
            <div className="section-title">Create room</div>
            <form onSubmit={handleCreateRoom}>
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  value={roomForm.name}
                  onChange={(event) =>
                    setRoomForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  disabled={readOnly}
                />
              </label>
              <label className="field">
                <span>Floor</span>
                <input
                  type="text"
                  value={roomForm.floor}
                  onChange={(event) =>
                    setRoomForm((prev) => ({ ...prev, floor: event.target.value }))
                  }
                  disabled={readOnly}
                />
              </label>
              <label className="field">
                <span>Capacity</span>
                <input
                  type="number"
                  min={0}
                  value={roomForm.capacity}
                  onChange={(event) =>
                    setRoomForm((prev) => ({
                      ...prev,
                      capacity: event.target.value
                    }))
                  }
                  disabled={readOnly}
                />
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={roomForm.notes}
                  onChange={(event) =>
                    setRoomForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  disabled={readOnly}
                />
              </label>
              <button
                className={`button ${readOnly ? "disabled" : ""}`}
                disabled={readOnly}
                title={readOnly ? roTooltip : undefined}
              >
                Create room
              </button>
            </form>
          </div>

          <div className="card">
            <div className="section-title">Rooms</div>
            {rooms.length === 0 ? (
              <p className="muted">No rooms created yet.</p>
            ) : (
              rooms.map((room) => {
                const isEditing = editingRoomId === room.id;
                const edit = isEditing ? roomEdit : null;
                return (
                  <div className="card" key={room.id}>
                    <h3>{room.name}</h3>
                    <p className="muted">
                      {room.floor ? `Floor: ${room.floor} ` : ""}
                      {room.capacity !== null && room.capacity !== undefined
                        ? `Capacity: ${room.capacity}`
                        : ""}
                    </p>
                    {room.notes && <p className="muted">{room.notes}</p>}
                    {isEditing && edit ? (
                      <>
                        <label className="field">
                          <span>Name</span>
                          <input
                            type="text"
                            value={edit.name}
                            onChange={(event) =>
                              setRoomEdit((prev) =>
                                prev ? { ...prev, name: event.target.value } : prev
                              )
                            }
                            disabled={readOnly}
                          />
                        </label>
                        <label className="field">
                          <span>Floor</span>
                          <input
                            type="text"
                            value={edit.floor}
                            onChange={(event) =>
                              setRoomEdit((prev) =>
                                prev ? { ...prev, floor: event.target.value } : prev
                              )
                            }
                            disabled={readOnly}
                          />
                        </label>
                        <label className="field">
                          <span>Capacity</span>
                          <input
                            type="number"
                            min={0}
                            value={edit.capacity}
                            onChange={(event) =>
                              setRoomEdit((prev) =>
                                prev
                                  ? { ...prev, capacity: event.target.value }
                                  : prev
                              )
                            }
                            disabled={readOnly}
                          />
                        </label>
                        <label className="field">
                          <span>Notes</span>
                          <textarea
                            rows={3}
                            value={edit.notes}
                            onChange={(event) =>
                              setRoomEdit((prev) =>
                                prev ? { ...prev, notes: event.target.value } : prev
                              )
                            }
                            disabled={readOnly}
                          />
                        </label>
                        <button
                          type="button"
                          className={`button ${readOnly ? "disabled" : ""}`}
                          disabled={readOnly}
                          title={readOnly ? roTooltip : undefined}
                          onClick={() => handleUpdateRoom(room.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => {
                            setEditingRoomId(null);
                            setRoomEdit(null);
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`button ${readOnly ? "disabled" : ""}`}
                        disabled={readOnly}
                        title={readOnly ? roTooltip : undefined}
                        onClick={() => startRoomEdit(room)}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {activeTab === "beds" && (
        <>
          <div className="card">
            <div className="section-title">Create bed</div>
            <form onSubmit={handleCreateBed}>
              <label className="field">
                <span>Bed code</span>
                <input
                  type="text"
                  value={bedForm.bedCode}
                  onChange={(event) =>
                    setBedForm((prev) => ({ ...prev, bedCode: event.target.value }))
                  }
                  disabled={readOnly}
                />
              </label>
              <label className="field">
                <span>Room</span>
                <select
                  value={bedForm.roomId}
                  onChange={(event) =>
                    setBedForm((prev) => ({ ...prev, roomId: event.target.value }))
                  }
                  disabled={readOnly}
                >
                  <option value="">Unassigned</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Status</span>
                <select
                  value={bedForm.status}
                  onChange={(event) =>
                    setBedForm((prev) => ({
                      ...prev,
                      status: event.target.value as Bed["status"]
                    }))
                  }
                  disabled={readOnly}
                >
                  {bedStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={bedForm.notes}
                  onChange={(event) =>
                    setBedForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  disabled={readOnly}
                />
              </label>
              <button
                className={`button ${readOnly ? "disabled" : ""}`}
                disabled={readOnly}
                title={readOnly ? roTooltip : undefined}
              >
                Create bed
              </button>
            </form>
          </div>

          <div className="card">
            <div className="section-title">Filters</div>
            <label className="field">
              <span>Status</span>
              <select
                value={bedStatusFilter}
                onChange={(event) =>
                  setBedStatusFilter(event.target.value as Bed["status"] | "all")
                }
              >
                <option value="all">All</option>
                {bedStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Room</span>
              <select
                value={bedRoomFilter}
                onChange={(event) => setBedRoomFilter(event.target.value)}
              >
                <option value="all">All rooms</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="card">
            <div className="section-title">Beds</div>
            {filteredBeds.length === 0 ? (
              <p className="muted">No beds match this filter.</p>
            ) : (
              filteredBeds.map((bed) => {
                const isEditing = editingBedId === bed.id;
                const edit = isEditing ? bedEdit : null;
                return (
                  <div className="card" key={bed.id}>
                    <h3>{bed.bed_code}</h3>
                    <p className="muted">
                      Room: {getRoomName(bed)} | Status: {bed.status}
                    </p>
                    {bed.notes && <p className="muted">{bed.notes}</p>}
                    {isEditing && edit ? (
                      <>
                        <label className="field">
                          <span>Bed code</span>
                          <input
                            type="text"
                            value={edit.bedCode}
                            onChange={(event) =>
                              setBedEdit((prev) =>
                                prev
                                  ? { ...prev, bedCode: event.target.value }
                                  : prev
                              )
                            }
                            disabled={readOnly}
                          />
                        </label>
                        <label className="field">
                          <span>Room</span>
                          <select
                            value={edit.roomId}
                            onChange={(event) =>
                              setBedEdit((prev) =>
                                prev ? { ...prev, roomId: event.target.value } : prev
                              )
                            }
                            disabled={readOnly}
                          >
                            <option value="">Unassigned</option>
                            {rooms.map((room) => (
                              <option key={room.id} value={room.id}>
                                {room.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Status</span>
                          <select
                            value={edit.status}
                            onChange={(event) =>
                              setBedEdit((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      status: event.target.value as Bed["status"]
                                    }
                                  : prev
                              )
                            }
                            disabled={readOnly}
                          >
                            {bedStatusOptions.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Notes</span>
                          <textarea
                            rows={3}
                            value={edit.notes}
                            onChange={(event) =>
                              setBedEdit((prev) =>
                                prev ? { ...prev, notes: event.target.value } : prev
                              )
                            }
                            disabled={readOnly}
                          />
                        </label>
                        <button
                          type="button"
                          className={`button ${readOnly ? "disabled" : ""}`}
                          disabled={readOnly}
                          title={readOnly ? roTooltip : undefined}
                          onClick={() => handleUpdateBed(bed.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => {
                            setEditingBedId(null);
                            setBedEdit(null);
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`button ${readOnly ? "disabled" : ""}`}
                        disabled={readOnly}
                        title={readOnly ? roTooltip : undefined}
                        onClick={() => startBedEdit(bed)}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}
