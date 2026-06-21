'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import type { TeamMemberRole } from '@b2b/shared/schemas';
import { PageHeader } from '@/components/shared/PageHeader';
import { SettingsTabs } from '@/components/merchant/SettingsTabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  useChangeTeamRole,
  useInviteTeamMember,
  useRemoveTeamMember,
  useTeam,
} from '@/hooks/useTeam';
import { ApiClientError } from '@/lib/api/error';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { TeamMember } from '@/types/api';

export default function TeamSettingsPage(): JSX.Element {
  const { data: team, isLoading, isError } = useTeam();
  const changeRole = useChangeTeamRole();
  const removeMember = useRemoveTeamMember();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);

  const onChangeRole = (member: TeamMember, role: TeamMemberRole): void => {
    changeRole.mutate(
      { id: member.id, role },
      {
        onSuccess: () => toast.success(`${displayName(member)} is now ${role}`),
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not change role'),
      },
    );
  };

  const confirmRemove = (): void => {
    if (!removeTarget) return;
    const target = removeTarget;
    removeMember.mutate(target.id, {
      onSuccess: () => {
        toast.success(`${displayName(target)} removed`);
        setRemoveTarget(null);
      },
      onError: (error) => {
        setRemoveTarget(null);
        toast.error(error instanceof ApiClientError ? error.message : 'Could not remove member');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage who can access this store's admin."
        actions={
          <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Invite team member
          </Button>
        }
      />
      <SettingsTabs />

      <section className="panel">
        {isError ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            You don&apos;t have access to team management.
          </p>
        ) : isLoading || !team ? (
          <LoadingSkeleton rows={4} columns={[2, 3, 1, 2, 1]} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((member) => {
                const isOwner = member.role === 'owner';
                return (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium text-gray-900">{displayName(member)}</TableCell>
                    <TableCell className="text-gray-600">{member.email}</TableCell>
                    <TableCell>
                      {isOwner ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-700">
                          Owner
                        </span>
                      ) : (
                        <Select
                          value={member.role}
                          onValueChange={(v) => onChangeRole(member, v as TeamMemberRole)}
                          disabled={changeRole.isPending}
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {member.lastLoginAt ? formatRelative(member.lastLoginAt) : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      {isOwner ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setRemoveTarget(member)}
                        >
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove this team member?"
        description={
          removeTarget ? (
            <span>{displayName(removeTarget)} will immediately lose access to this store&apos;s admin.</span>
          ) : null
        }
        confirmLabel="Remove"
        destructive
        isLoading={removeMember.isPending}
        onConfirm={confirmRemove}
      />
    </>
  );
}

function displayName(member: TeamMember): string {
  const name = [member.firstName, member.lastName].filter((part) => part && part.length > 0).join(' ');
  return name.length > 0 ? name : member.email;
}

/**
 * Invite modal. The UI is built, but invitations are a v1 stub (Clerk owns user
 * identity), so the body says "coming soon" and Send Invite just acknowledges.
 */
function InviteModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const invite = useInviteTeamMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamMemberRole>('staff');

  const onSend = (): void => {
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      toast.error('Enter an email address');
      return;
    }
    invite.mutate(
      { email: trimmed, role },
      {
        onSuccess: () => {
          toast.success(`Invitation sent to ${trimmed}`);
          setEmail('');
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(error instanceof ApiClientError ? error.message : 'Could not send invite'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !invite.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>Team invitations are coming soon.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className={cn('rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800')}>
            Team invitations are coming soon — this form is a preview and won&apos;t send an email yet.
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inviteEmail">Email</Label>
            <Input
              id="inviteEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inviteRole">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as TeamMemberRole)}>
              <SelectTrigger id="inviteRole">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="staff">Staff</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="default" disabled={invite.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invite.isPending} onClick={onSend}>
            {invite.isPending ? <Spinner /> : null}
            Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
